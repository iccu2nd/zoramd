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
import { resolveFeature, checkAccessRule, getCustomCommandMap, parseCustomCommands } from './lib/featureGate.js'
import { runWithFreeQueue } from './lib/freeQueue.js'
import { isAccountPremium } from './lib/db/subscription.js'
import { resolveBotConfig } from './lib/botConfig.js'
import { logCommandError } from './lib/commandErrors.js'
import { trackMessageIn, trackCommand } from './lib/botMetrics.js'
import {
    resolveRuntimeSettings,
    renderMessage,
    ensureUserLimit,
    consumeUserLimit,
    checkCooldown
} from './lib/botSettingsService.js'
import { isPremiumActive as isUserPremiumActive } from './lib/plugins.js'

const DEFAULT_PREFIXES = ['.', '/', '#', '!']

const DELETE_CACHE_MAX = 800
const DELETE_CACHE_TTL_MS = 15 * 60 * 1000
const PP_FETCH_TIMEOUT_MS = 1000
const SCHEDULED_LEAVE_INTERVAL_MS = 5 * 60 * 1000
const seenMessageIds = new Map()
const SEEN_MESSAGE_TTL_MS = 10 * 60 * 1000

function isDuplicateMessage(sock, raw) {
    const id = raw?.key?.id
    if (!id) return false
    const key = `${sock.sessionId || 'default'}:${id}`
    if (seenMessageIds.has(key)) return true
    seenMessageIds.set(key, Date.now())
    if (seenMessageIds.size > 4000) {
        const cutoff = Date.now() - SEEN_MESSAGE_TTL_MS
        for (const [entry, timestamp] of seenMessageIds) {
            if (timestamp < cutoff) seenMessageIds.delete(entry)
        }
    }
    return false
}

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

const PROFILE_MSG = process.env.PROFILE_MSG === '1' || process.env.PROFILE_MSG === 'true'

// Ambang untuk warning "WA network delay" -- selisih besar antara timestamp yang
// distempel WhatsApp saat pesan dikirim (raw.messageTimestamp) dan saat event
// messages.upsert benar-benar sampai ke process ini (tRecv). Ini SEBELUM baris
// kode kita mana pun sempat jalan, jadi kalau angka ini yang besar (bukan
// ser->gate->run di bawah), root cause-nya ada di sisi WhatsApp/Baileys
// (retry receipt karena signal session decrypt gagal, socket idle, dsb),
// BUKAN di handler/queue/database yang kita audit.
const WA_NETWORK_DELAY_WARN_MS = Number(process.env.WA_NETWORK_DELAY_WARN_MS || 4000)

function waMessageTimestampMs(raw) {
    const ts = raw?.messageTimestamp
    if (ts == null) return null
    // Baileys mengembalikan Long (punya .toNumber()) atau number biasa, tergantung versi/transport.
    const seconds = typeof ts === 'object' && typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts)
    return Number.isFinite(seconds) ? seconds * 1000 : null
}

export async function handleMessage(sock, config, { messages, type }) {
    const tRecv = Date.now()
    // Selalu pakai identity live dari sock.botConfig (Bot Settings premium)
    config = resolveBotConfig(sock, config || {})
    if (type !== 'notify') return
    const raw = messages[0]
    if (!raw?.message) return
    if (isDuplicateMessage(sock, raw)) return

    // Ukur delay SEBELUM proses kita mana pun jalan: waktu antara WhatsApp
    // menstempel pesan dan event messages.upsert sampai ke sini. Kalau ini besar,
    // pesan sudah "telat" sebelum masuk handler -- bukan queue/db/plugin kita.
    const waMsgTsMs = waMessageTimestampMs(raw)
    const waNetworkDelayMs = waMsgTsMs != null ? Math.max(0, tRecv - waMsgTsMs) : null
    if (waNetworkDelayMs != null && waNetworkDelayMs > WA_NETWORK_DELAY_WARN_MS) {
        console.warn(chalk.yellowBright(
            `[wa-delay] Pesan telat ${waNetworkDelayMs}ms sebelum sampai ke handler (dari timestamp WA ke messages.upsert). ` +
            `Ini terjadi di luar kode bot (socket/WA-side), bukan di handler/queue/database.`
        ))
    }

    const rawType = getContentType(raw.message)
    if (rawType === 'protocolMessage') {
        if (raw.message.protocolMessage.type === proto.Message.ProtocolMessage.Type.REVOKE) antiDelete(sock, raw)
        return
    }
    if (rawType === 'senderKeyDistributionMessage' || rawType === 'reactionMessage' || rawType === 'pollUpdateMessage') return

    const tSer0 = Date.now()
    const m = await serialize(sock, raw)
    const tSer1 = Date.now()
    if (!m || !m.message) return

    // Dipakai plugin (mis. .ping) untuk membedah latency: berapa dari
    // WA/jaringan (di luar kendali kode kita) vs berapa dari proses internal bot.
    m.tRecv = tRecv
    m.waNetworkDelayMs = waNetworkDelayMs

    // Per-bot settings (cached). Live on sock after dashboard save.
    const botIdForGate = config.botId || sock.sessionId || 'default'
    const botSettings = await resolveRuntimeSettings(sock, botIdForGate)
    m._botSettings = botSettings

    // Bot disabled
    if (botSettings.enabled === false && !m.isOwner) return

    // Maintenance mode
    if (botSettings.maintenance && !m.isOwner) {
        const msg = renderMessage(
            botSettings.messages?.maintenance || botSettings.maintenanceMessage || 'Bot sedang maintenance.',
            { botName: config.botName, prefix: (botSettings.prefixes || DEFAULT_PREFIXES)[0], timezone: botSettings.timezone }
        )
        // Only reply if looks like a command to avoid spam on every chat message
        const maybePrefix = (botSettings.prefixes || DEFAULT_PREFIXES).some(p => m.body?.startsWith(p))
        if (maybePrefix || botSettings.noprefix) {
            await m.reply(msg).catch(() => {})
        }
        return
    }

    // Mode self — prefer botSettings, fallback legacy settings
    const mode = botSettings.mode || settings.mode || 'public'
    if (mode === 'self') {
        const botJid = jidNormalizedUser(sock.user.id)
        if (!m.isOwner && m.sender !== botJid) return
    }

    m.userInit = loadUser(m)

    const gconlyFlag = botSettings.gconly ?? settings.gconly
    const gconlyPremBypass = botSettings.gconlyPremiumBypass ?? settings.gconlyPremiumBypass
    const gconlyPremiumExempt = gconlyPremBypass && isPremiumActive(global.db.data.users[m.sender])

    if (gconlyFlag && !sock.isJadibotSession && !m.isGroup && !m.isOwner && !hasActiveMenfesSession(m.sender) && !gconlyPremiumExempt) {
        if (gconlyFlag === 'closed') return
        if (gconlyFlag === 'join') {
            const allowed = await checkGconlyAccess(sock, m.sender)
            if (!allowed) {
                await notifyGconlyOnce(sock, m)
                return
            }
        }
    }

    if (m.isGroup && !m.key.fromMe && global.db.data.chats[m.from]?.antidelete) cacheForDelete(m)
    // Non-blocking side effects
    if (botSettings.autoread ?? settings.autoread) sock.readMessages([m.key]).catch(() => {})

    const activePrefixes = Array.isArray(botSettings.prefixes) && botSettings.prefixes.length
        ? botSettings.prefixes
        : DEFAULT_PREFIXES
    const prefix = activePrefixes.find(p => m.body.startsWith(p))
    let afterPrefix, cmd, plugin

    if (prefix) {
        afterPrefix = m.body.slice(prefix.length).trim()
        cmd = afterPrefix.split(/ +/).shift().toLowerCase()
        plugin = getPlugin(cmd)
    } else if (botSettings.noprefix ?? settings.noprefix) {
        afterPrefix = m.body.trim()
        cmd = afterPrefix.split(/ +/).shift().toLowerCase()
        plugin = getPlugin(cmd)
    }

    // Resolve feature once and reuse. Custom-command check + gate share the same fetch
    // (featureGate has long TTL + singleflight so idle bursts do not stampede Mongo).
    let feat = null
    if (plugin) {
        const featKey = (plugin.cmd && plugin.cmd[0]) || cmd
        feat = await resolveFeature(botIdForGate, featKey)
        const customList = parseCustomCommands(feat.customCommand)
        if (customList.length && !customList.includes(cmd)) {
            plugin = null
            feat = null
        }
    }
    if (!plugin && cmd) {
        const customMap = await getCustomCommandMap(botIdForGate)
        const mappedKey = customMap.get(cmd)
        if (mappedKey) {
            plugin = getPlugin(mappedKey)
            if (plugin) {
                feat = await resolveFeature(botIdForGate, (plugin.cmd && plugin.cmd[0]) || mappedKey)
            }
        }
    }

    m.pluginName = plugin ? cmd : undefined
    printChatLog(m, sock?.sessionId)

    // onMessage plugins: run without serializing the whole command pipeline.
    // Feature checks still apply; handlers that claim the message short-circuit.
    const onMsgHandlers = getOnMessageHandlers()
    if (onMsgHandlers.length) {
        for (const handler of onMsgHandlers) {
            try {
                const fKey = (handler.cmd && handler.cmd[0]) || handler.featureKey
                if (fKey) {
                    const onFeat = await resolveFeature(botIdForGate, fKey)
                    if (!onFeat.enabled) continue
                    if (!checkAccessRule(onFeat.accessRules || onFeat.accessRule, m)) continue
                }
                const isHandled = await handler.onMessage(m, { sock, config })
                if (isHandled) return
            } catch (e) {
                console.error(e)
            }
        }
    }

    const user = global.db.data.users[m.sender]
    const msgTpl = botSettings.messages || {}
    const pfx = prefix || (activePrefixes[0] || '.')

    if (!plugin) {
        if (prefix && cmd) {
            if (m.isOwner || !user?.banned) {
                const candidates = getCommandNames(m.isOwner)
                const suggestions = findClosestCommands(cmd, candidates)
                if (suggestions.length) {
                    const unknownTpl = msgTpl.unknownCommand
                    if (unknownTpl) {
                        return m.reply(renderMessage(unknownTpl, {
                            command: cmd, prefix: pfx, botName: config.botName,
                            user: m.pushName, username: m.pushName, number: m.sender?.split('@')[0],
                            timezone: botSettings.timezone
                        }))
                    }
                    return m.reply(config.text.didyoumean(prefix, cmd, suggestions))
                }
            }
        }
        return
    }

    const canonicalCmd = plugin.cmd[0]
    const blockedList = botSettings.blockedCmds?.length ? botSettings.blockedCmds : (settings.blockedCmds || [])
    if (!m.isOwner && blockedList.includes(canonicalCmd)) {
        return m.reply(config.text.blockedCmd(canonicalCmd))
    }

    if (!m.isOwner && m.isGroup && plugin.category === 'rpg' && global.db.data.chats[m.from]?.rpgOff) {
        return m.reply('Fitur RPG sedang dimatikan di grup ini.')
    }

    if (!m.isOwner && user?.banned) {
        const banMsg = msgTpl.banned
        if (banMsg) await m.reply(renderMessage(banMsg, { botName: config.botName, user: m.pushName })).catch(() => {})
        return
    }

    // ---- Verification gate (Bot Settings controlled) ----
    const verifOn = botSettings.verificationEnabled !== false
    if (verifOn && !m.isOwner && cmd !== 'verify' && !user?.registered) {
        const isPremUser = isPremiumActive(user)
        const bypass =
            (botSettings.verificationBypassOwner && m.isOwner) ||
            (botSettings.verificationBypassAdmin && m.isAdmin) ||
            (botSettings.verificationBypassPremium && isPremUser)
        if (!bypass) {
            const body = renderMessage(
                botSettings.verificationMessage || msgTpl.verificationRequired || config.text.notRegistered,
                { prefix: pfx, botName: config.botName, user: m.pushName, username: m.pushName, number: m.sender?.split('@')[0], timezone: botSettings.timezone }
            )
            let pp
            try {
                const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PP_FETCH_TIMEOUT_MS))
                pp = await Promise.race([sock.profilePictureUrl(m.sender, 'image'), timeout])
            } catch { pp = null }
            return sock.sendInteractiveButton(m.from, {
                body,
                footer: botSettings.footer || 'Registration Message',
                ...(pp ? { image: pp } : {}),
                buttons: [
                    { type: 'reply', label: 'Verifikasi Sekarang', id: `${pfx}verify` }
                ]
            }, { quoted: m }).catch(() => m.reply(body))
        }
    }

    // Feature Settings gate — reuse earlier resolve when possible
    if (!feat) {
        const featureKey = (plugin.cmd && plugin.cmd[0]) || cmd
        feat = await resolveFeature(botIdForGate, featureKey)
    }
    if (!feat.enabled) return
    if (!checkAccessRule(feat.accessRules || feat.accessRule, m)) return

    // Feature-level premiumOnly / requireVerified
    if (feat.premiumOnly && !m.isOwner && !isPremiumActive(user)) {
        return m.reply(renderMessage(msgTpl.premiumRequired || 'Fitur ini khusus Premium.', {
            prefix: pfx, botName: config.botName, command: cmd
        }))
    }
    if (feat.requireVerified && !m.isOwner && !user?.registered) {
        return m.reply(renderMessage(msgTpl.verificationRequired || botSettings.verificationMessage || config.text.notRegistered, {
            prefix: pfx, botName: config.botName, command: cmd
        }))
    }

    // Cooldown (per feature)
    const cdSec = Number(feat.cooldown) || 0
    if (cdSec > 0 && !m.isOwner) {
        const cd = checkCooldown(botIdForGate, m.sender, canonicalCmd, cdSec)
        if (!cd.ok) {
            return m.reply(`⏱ Tunggu *${cd.retryAfter}s* sebelum memakai command ini lagi.`)
        }
    }

    // Limit system
    if (botSettings.limitEnabled && !m.isOwner) {
        const isPremUser = isPremiumActive(user)
        const role = m.isAdmin ? 'admin' : (isPremUser ? 'premium' : 'free')
        const { remaining, quota } = ensureUserLimit(user, botSettings, role)
        const cost = Math.max(0, Number(feat.limitCost) || 1)
        if (quota >= 0 && remaining < cost) {
            return m.reply(renderMessage(
                botSettings.limitMessage || msgTpl.limitHabis || 'Limit harian kamu sudah habis.',
                { prefix: pfx, botName: config.botName, command: cmd, user: m.pushName }
            ))
        }
        // consume after successful gate (before run) — still consume even if plugin fails? yes, standard
        if (quota >= 0 && cost > 0) consumeUserLimit(user, cost)
    }

    const tGate = Date.now()

    try {
        const textWithoutCmd = afterPrefix.slice(cmd.length).trim()
        const doTyping = botSettings.autotyping ?? settings.autotyping
        const doRecording = botSettings.autorecording
        if (doTyping) sock.sendPresenceUpdate('composing', m.from).catch(() => {})
        else if (doRecording) sock.sendPresenceUpdate('recording', m.from).catch(() => {})

        // Optional response delay
        const delayMs = Number(botSettings.responseDelayMs) || 0
        if (delayMs > 0 && delayMs < 10000) {
            await new Promise(r => setTimeout(r, delayMs))
        }

        // Custom Response (Feature Settings): timpa balasan pertama plugin dengan teks custom.
        if (feat.customResponse) {
            m._customResponse = feat.customResponse
            const originalReply = m.reply
            let customResponseUsed = false
            m.reply = (text, options = {}) => {
                if (!customResponseUsed) {
                    customResponseUsed = true
                    return originalReply(feat.customResponse, options)
                }
                return originalReply(text, options)
            }
        }

        // Premium: prefer socket-level cache set at connect. Refresh at most every 5 min
        // so idle/first-command path is not a Mongo round-trip, without freezing plan forever.
        const PREMIUM_SOCK_TTL_MS = 5 * 60_000
        const premAge = Date.now() - (sock._premiumCheckedAt || 0)
        let premiumUser = !!(sock.botConfig?.isPremiumAccount || sock.isPremiumAccount)
        if (sock._premiumCheckedAt == null || premAge > PREMIUM_SOCK_TTL_MS) {
            try {
                const ownerId = sock.botConfig?.ownerAccountId || config.ownerAccountId
                if (ownerId) {
                    premiumUser = await isAccountPremium(String(ownerId))
                    if (sock.botConfig) sock.botConfig.isPremiumAccount = premiumUser
                    sock.isPremiumAccount = premiumUser
                    sock._premiumCheckedAt = Date.now()
                }
            } catch {}
        }

        const isPremiumLane = premiumUser || !!(botSettings.fastrespon ?? settings.fastrespon)
        const sessionKey = sock.sessionId || config.botId || 'default'
        trackMessageIn(sessionKey, m.sender)
        const t0 = Date.now()
        let cmdOk = true
        try {
            // Per-chat concurrency only — independent chats never wait on each other.
            // Heavy commands keep their own timeout tier; they do not block light commands
            // in other chats, and same-chat slots free as soon as each job settles/timeouts.
            // Light categories are preferred inside the same lane so .ping/menu/admin stay snappy.
            await runWithFreeQueue(isPremiumLane, async () => {
                const tPlugin0 = Date.now()
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
                if (PROFILE_MSG) {
                    const netPart = waNetworkDelayMs != null ? `wa-network=${waNetworkDelayMs}ms ` : ''
                    console.log(chalk.gray(
                        `[prof] ${cmd} ${netPart}recv→ser=${tSer1 - tSer0}ms ser→gate=${tGate - tSer1}ms gate→run=${tPlugin0 - t0}ms run=${Date.now() - tPlugin0}ms internal-total=${Date.now() - tRecv}ms`
                    ))
                }
            }, {
                key: `${sessionKey}:${m.from || 'unknown'}`,
                category: plugin.category,
                timeoutMs: plugin.timeoutMs
            })
        } catch (cmdErr) {
            cmdOk = false
            const msg = cmdErr?.message || String(cmdErr)
            // User-facing soft errors — no stack spam, no owner report
            if (msg.includes('Command timed out')) {
                await m.reply('⏱ Command membutuhkan waktu terlalu lama. Coba lagi atau gunakan command lain.').catch(() => {})
                return
            }
            if (msg.includes('Too many concurrent commands')) {
                await m.reply('⏳ Bot sedang sibuk di chat ini. Tunggu sebentar lalu coba lagi.').catch(() => {})
                return
            }
            throw cmdErr
        } finally {
            trackCommand(sessionKey, cmdOk, Date.now() - t0)
        }
        if (botSettings.autotyping ?? settings.autotyping ?? botSettings.autorecording) sock.sendPresenceUpdate('paused', m.from).catch(() => {})
    } catch (e) {
        const msg = e?.message || String(e)
        // Soft / expected errors already handled above
        if (msg.includes('Command timed out') || msg.includes('Too many concurrent commands')) return

        console.error(chalk.redBright(e))
        logCommandError({
            botId: config.botId || sock.sessionId,
            sessionId: sock.sessionId,
            cmd,
            message: msg,
            stack: e?.stack
        }).catch(() => {})

        // User-facing error (never leak stack/token by default)
        try {
            const bs = m._botSettings || {}
            const tpl = bs.messages?.error || 'Maaf fitur sedang error.'
            const showTech = bs.showTechnicalError === true
            const userMsg = renderMessage(tpl, {
                e: showTech ? msg : '',
                error: showTech ? msg : '',
                command: cmd || '',
                prefix: prefix || '.',
                botName: config.botName,
                user: m.pushName,
                username: m.pushName,
                number: m.sender?.split('@')[0],
                timezone: bs.timezone
            })
            // Only append technical detail when explicitly enabled
            const finalMsg = showTech && !String(tpl).includes('${e}') && !String(tpl).includes('${error}')
                ? `${userMsg}\n\n> ${msg}`
                : userMsg
            await m.reply(finalMsg).catch(() => {})
        } catch {}

        const doReport = (m._botSettings?.errorReport ?? settings.errorReport)
        if (doReport) {
            reportPluginError({ sock, config, m, cmd, prefix: prefix || '', text: afterPrefix?.slice(cmd.length).trim() || '', e }).catch(() => {})
        }
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
    config = resolveBotConfig(sock, config || {})
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
        // Fallback ke Bot Settings global messages
        if (!text) {
            const bs = sock._botSettings
            text = action === 'add' ? (bs?.messages?.welcome) : (bs?.messages?.goodbye)
        }
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
