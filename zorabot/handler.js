import { jidNormalizedUser, jidDecode, DisconnectReason, getContentType, proto } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import chalk from 'chalk'
import { format } from 'util'
import { serialize } from './lib/serialize.js'
import { getPlugin, getOnMessageHandlers, getOnConnectHandlers, getAllCommandEntries, getCommandNames, getPluginFile } from './lib/plugins.js'
import { findClosestCommands } from './lib/didyoumean.js'
import loadUser, { saveMetadata, syncGroupParticipants, getContact, getLidMapping, settings } from './lib/database.js'
import { printChatLog } from './lib/chatlog.js'
import { groupCache, setCachedGroupMetadata } from './lib/simple.js'
import { checkGconlyAccess, notifyGconlyOnce } from './lib/gconly.js'
import { hasActiveMenfesSession } from './plugins/_menfes.js'
import { isPremiumActive } from './lib/plugins.js'
import { setBotStatus } from './lib/db/accounts.js'
import { resolveFeature, checkAccessRule } from './lib/featureGate.js'

const prefixes = ['.', '/', '#', '!']

const DELETE_CACHE_MAX = 800
const DELETE_CACHE_TTL_MS = 15 * 60 * 1000
const PP_FETCH_TIMEOUT_MS = 1000
const SCHEDULED_LEAVE_INTERVAL_MS = 5 * 60 * 1000

export async function reportPluginError({ sock, config, m, cmd, prefix = '', text = '', e }) {
    try {
        const file = getPluginFile(cmd) || 'Tidak diketahui'
        const errorLog = format(e)
        const report = `*🗂️ Plugin:* ${file}\n*👤 Sender:* ${m.sender}\n*💬 Chat:* ${m.from}\n*💻 Command:* ${prefix}${cmd} ${text}\n📄 *Error Logs:*\n\n\`\`\`${errorLog}\`\`\``.trim()

        for (const num of config.ownerNumber || []) {
            const jid = num.replace(/[^0-9]/g, '') + '@s.whatsapp.net'
            sock.sendMessage(jid, { text: report }).catch(() => {})
        }
    } catch (err) {
        console.error(chalk.redBright(err))
    }
}

const deleteCache = new Map()

function cacheForDelete(m) {
    if (deleteCache.size >= DELETE_CACHE_MAX) deleteCache.delete(deleteCache.keys().next().value)
    deleteCache.set(m.id, { from: m.from, sender: m.sender, message: m.message })
    setTimeout(() => deleteCache.delete(m.id), DELETE_CACHE_TTL_MS)
}

async function antiDelete(sock, raw) {
    const deletedKey = raw.message?.protocolMessage?.key
    if (!deletedKey?.id) return

    const cached = deleteCache.get(deletedKey.id)
    if (!cached) return
    if (!global.db.data.chats[cached.from]?.antidelete) return

    const notif = `*Pesan Dihapus*\n\n- Oleh: @${cached.sender.split('@')[0]}`
    try {
        await sock.relayMessage(cached.from, cached.message, {})
        await sock.sendMessage(cached.from, { text: notif, mentions: [cached.sender] })
    } catch (e) {
        console.error(e)
    }
}

export async function handleMessage(sock, config, { messages, type }) {
    if (type !== 'notify') return
    const raw = messages[0]
    if (!raw?.message) return

    const rawType = getContentType(raw.message)
    if (rawType === 'protocolMessage') {
        if (raw.message.protocolMessage.type === proto.Message.ProtocolMessage.Type.REVOKE) antiDelete(sock, raw)
        return
    }
    if (rawType === 'senderKeyDistributionMessage' || rawType === 'reactionMessage' || rawType === 'pollUpdateMessage') return

    const m = await serialize(sock, raw)
    if (!m || !m.message) return

    if (settings.mode === 'self') {
        const botJid = jidNormalizedUser(sock.user.id)
        if (!m.isOwner && m.sender !== botJid) return
    }

    m.userInit = loadUser(m)

    const gconlyPremiumExempt = settings.gconlyPremiumBypass && isPremiumActive(global.db.data.users[m.sender])

    if (settings.gconly && !sock.isJadibotSession && !m.isGroup && !m.isOwner && !hasActiveMenfesSession(m.sender) && !gconlyPremiumExempt) {
        if (settings.gconly === 'closed') return

        if (settings.gconly === 'join') {
            const allowed = await checkGconlyAccess(sock, m.sender)
            if (!allowed) {
                await notifyGconlyOnce(sock, m)
                return
            }
        }
    }

    if (m.isGroup && !m.key.fromMe && global.db.data.chats[m.from]?.antidelete) cacheForDelete(m)
    if (settings.autoread) sock.readMessages([m.key]).catch(() => {})

    const isEvalCmd = m.isOwner && (m.body.startsWith('=>') || m.body.startsWith('>') || m.body.startsWith('$'))

    const prefix = prefixes.find(p => m.body.startsWith(p))
    let afterPrefix, cmd, plugin

    if (prefix) {
        afterPrefix = m.body.slice(prefix.length).trim()
        cmd = afterPrefix.split(/ +/).shift().toLowerCase()
        plugin = getPlugin(cmd)
    } else if (settings.noprefix) {
        afterPrefix = m.body.trim()
        cmd = afterPrefix.split(/ +/).shift().toLowerCase()
        plugin = getPlugin(cmd)
    }

    m.pluginName = isEvalCmd ? 'owner-eval' : (plugin ? cmd : undefined)
    printChatLog(m)

    // onMessage plugins: respect Feature Settings OFF (backend, not just UI)
    const botIdForGate = config.botId || sock.sessionId || 'default'
    for (const handler of getOnMessageHandlers()) {
        try {
            const fKey = (handler.cmd && handler.cmd[0]) || handler.featureKey
            if (fKey) {
                const feat = await resolveFeature(botIdForGate, fKey)
                if (!feat.enabled) continue
                if (!checkAccessRule(feat.accessRule, m)) continue
            }
            const isHandled = await handler.onMessage(m, { sock, config })
            if (isHandled) return
        } catch (e) {
            console.error(e)
        }
    }

    if (isEvalCmd) {
        const ownerPlugin = getPlugin('>')
        if (ownerPlugin) {
            return await ownerPlugin.run(m, { sock, config, text: m.text, isOwner: m.isOwner, jid: m.from })
        }
    }

    if (!plugin) {
        if (prefix && cmd) {
            const bannedUser = global.db.data.users[m.sender]?.banned
            if (m.isOwner || !bannedUser) {
                const candidates = getCommandNames(m.isOwner)
                const suggestions = findClosestCommands(cmd, candidates)
                if (suggestions.length) return m.reply(config.text.didyoumean(prefix, cmd, suggestions))
            }
        }
        return
    }

    const canonicalCmd = plugin.cmd[0]
    if (!m.isOwner && settings.blockedCmds.includes(canonicalCmd)) return m.reply(config.text.blockedCmd(canonicalCmd))

    if (!m.isOwner && m.isGroup && plugin.category === 'rpg' && global.db.data.chats[m.from]?.rpgOff) {
        return m.reply('Fitur RPG sedang dimatikan di grup ini.')
    }

    const user = global.db.data.users[m.sender]
    if (!m.isOwner && user?.banned) return

    if (!m.isOwner && cmd !== 'verify' && !user?.registered) {
        let pp
        try {
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PP_FETCH_TIMEOUT_MS))
            pp = await Promise.race([sock.profilePictureUrl(m.sender, 'image'), timeout])
        } catch {
            pp = null
        }
        return sock.sendInteractiveButton(m.from, {
            body: config.text.notRegistered,
            footer: 'Registration Message',
            ...(pp ? { image: pp } : {}),
            buttons: [
                { type: 'reply', label: 'Verifikasi Sekarang', id: `${prefix || '.'}verify` }
            ]
        }, { quoted: m }).catch(() => m.reply(config.text.notRegistered))
    }

    // Feature Settings gate: if OFF, do not run plugin logic at all
    const botId = config.botId || sock.sessionId || 'default'
    const featureKey = (plugin.cmd && plugin.cmd[0]) || cmd
    const feat = await resolveFeature(botId, featureKey)
    if (!feat.enabled) return
    if (!checkAccessRule(feat.accessRule, m)) return

    try {
        const textWithoutCmd = afterPrefix.slice(cmd.length).trim()
        if (settings.autotyping) sock.sendPresenceUpdate('composing', m.from).catch(() => {})
        // Allow plugins to use custom response if set
        if (feat.customResponse) m._customResponse = feat.customResponse
        await plugin.run(m, {
            sock,
            config,
            text: textWithoutCmd,
            jid: m.from,
            prefix: prefix || '',
            cmd,
            isOwner: m.isOwner,
            isAdmin: m.isAdmin,
            isBotAdmin: m.isBotAdmin
        })
        if (settings.autotyping) sock.sendPresenceUpdate('paused', m.from).catch(() => {})
    } catch (e) {
        console.error(chalk.redBright(e))
        if (settings.errorReport) reportPluginError({ sock, config, m, cmd, prefix: prefix || '', text: afterPrefix.slice(cmd.length).trim(), e })
    }
}

const decodeJid = (jid) => {
    if (!jid) return jid
    if (typeof jid !== 'string') return jid.id || jid.jid || jid
    if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {}
        return (decode.user && decode.server && decode.user + '@' + decode.server) || jid
    }
    return jid
}

export async function syncAllGroups(sock) {
    const groups = await sock.groupFetchAllParticipating()
    for (const id in groups) {
        const meta = groups[id]
        if (meta.ephemeralDuration) groupCache.set(id, meta.ephemeralDuration)
        setCachedGroupMetadata(id, meta)
        saveMetadata(id, meta.subject, meta.desc?.toString(), meta.participants)
        syncGroupParticipants(id, meta.participants)
    }
}

export async function onGroupsUpdate(sock, [event]) {
    try {
        const metadata = await sock.groupMetadata(event.id)
        if (metadata) {
            setCachedGroupMetadata(event.id, metadata)
            saveMetadata(event.id, metadata.subject, metadata.desc?.toString(), metadata.participants)
        }
    } catch (e) {}
}

export async function onParticipantsUpdate(sock, config, { id, participants, action }) {
    let metadata = null
    try {
        metadata = await sock.groupMetadata(id)
        if (metadata) {
            setCachedGroupMetadata(id, metadata)
            saveMetadata(id, metadata.subject, metadata.desc?.toString(), metadata.participants)
            syncGroupParticipants(id, metadata.participants)
        }
    } catch (e) {}

    if (settings.mode === 'self') return

    const chatSettings = global.db.data.chats[id] || {}
    if (action === 'add' && !chatSettings.welcome) return
    if (action === 'remove' && !chatSettings.goodbye) return
    if (action !== 'add' && action !== 'remove') return

    const botJid = jidNormalizedUser(sock.user.id)
    const now = new Date()
    const time = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(now)
    const date = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)
    const groupSubject = metadata?.subject || 'Grup'

    await Promise.all(participants.map(item => notifyParticipant({
        sock, config, item, botJid, metadata, action, chatSettings, groupSubject, date, time, groupId: id
    })))
}

async function notifyParticipant({ sock, config, item, botJid, metadata, action, chatSettings, groupSubject, date, time, groupId }) {
    try {
        let jid = decodeJid(item)
        if (jid === botJid) return

        if (jid.endsWith('@lid')) {
            const found = metadata?.participants?.find(p => p.id === jid)
            if (found?.phoneNumber) {
                jid = found.phoneNumber
            } else {
                const mapped = getLidMapping(jid)
                if (mapped) jid = mapped
            }
        }
        jid = jidNormalizedUser(jid)

        const dbContact = getContact(jid)
        const pushName = (dbContact?.pushname && dbContact.pushname !== 'null') ? dbContact.pushname : jid.split('@')[0]

        let ppUser
        try {
            const fetchPP = (async () => {
                try {
                    return await sock.profilePictureUrl(jid, 'image')
                } catch {
                    return await sock.profilePictureUrl(jid, 'preview')
                }
            })()
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PP_FETCH_TIMEOUT_MS))
            ppUser = await Promise.race([fetchPP, timeout])
        } catch (e) {
            ppUser = config.thumbnail1
        }
        if (!ppUser) ppUser = config.thumbnail1

        if (settings.mode === 'self') return

        let text = action === 'add' ? chatSettings.welcomeText : chatSettings.goodbyeText
        if (!text) return

        text = String(text)
            .replace(/@pushname/g, `@${jid.split('@')[0]}`)
            .replace(/@nama/g, String(pushName))
            .replace(/@gcname/g, String(groupSubject))
            .replace(/@date/g, String(date))
            .replace(/@jam/g, String(time))

        await sock.sendImage(groupId, ppUser, text, '', { mentions: [jid] })
    } catch (e) {}
}

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30000

export function onConnectionUpdate(sock, config, startBot) {
    // reconnectAttempts/isReconnecting hidup per-panggilan (per sock), bukan module-level,
    // supaya tiap instance bot (nantinya tiap user di mode multi-session) punya state reconnect sendiri
    // dan gak saling ganggu.
    let reconnectAttempts = 0
    let isReconnecting = false

    return async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
            reconnectAttempts = 0
            isReconnecting = false
            setBotStatus(config.botId, 'connected').catch(() => {})

            console.log()
            console.log(chalk.greenBright.bold(config.text.connected(config.botName)))
            console.log()
            await syncAllGroups(sock)

            for (const plugin of getOnConnectHandlers()) {
                try {
                    await plugin.onConnect(sock, config)
                } catch (e) {
                    console.error(chalk.redBright(e))
                }
            }

            startScheduledLeaves(sock)
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode
            if (reason === DisconnectReason.loggedOut) {
                setBotStatus(config.botId, 'logged_out').catch(() => {})
                return
            }
            setBotStatus(config.botId, 'disconnected').catch(() => {})

            // Cegah startBot() kepanggil dobel kalau event 'close' terpicu lebih dari sekali
            // dari socket yang sama (jadi gak ada dua koneksi/listener jalan bersamaan).
            if (isReconnecting) return
            isReconnecting = true

            const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts)
            reconnectAttempts++
            console.log(chalk.yellowBright(`Koneksi terputus, reconnect dalam ${(delay / 1000).toFixed(1)}s...`))
            setTimeout(() => startBot(), delay)
        }
    }
}

let scheduledLeavesInterval = null

function startScheduledLeaves(sock) {
    // Tiap kali koneksi 'open' (termasuk setelah reconnect) fungsi ini kepanggil lagi —
    // tanpa clear interval lama, tiap reconnect numpuk satu worker baru yang jalan terus-terusan.
    if (scheduledLeavesInterval) clearInterval(scheduledLeavesInterval)

    scheduledLeavesInterval = setInterval(async () => {
        const now = Date.now()
        for (const jid in settings.scheduledLeaves) {
            if (now < settings.scheduledLeaves[jid]) continue
            try {
                await sock.groupLeave(jid)
            } catch (e) {
                console.error(chalk.redBright(e))
            }
            delete settings.scheduledLeaves[jid]
        }
    }, SCHEDULED_LEAVE_INTERVAL_MS)
}
