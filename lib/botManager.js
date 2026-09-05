/**
 * BotManager – alur koneksi mengikuti pola rezora (connection.js + handler):
 * - creds.update SEBELUM pairing
 * - markOnlineOnConnect: true
 * - close != loggedOut → restart dengan session yang sama
 * - 515 setelah pairing code = normal, jangan clear session / jangan hapus kode
 */
import chalk from 'chalk'
import makeWASocket, {
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason
} from '@whiskeysockets/baileys'
import { pushNotification } from './notifications.js'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import { useMongoAuthState } from './mongoAuthState.js'
import wrapSocket from './simple.js'
import { onGroupsUpdate, onParticipantsUpdate, handleMessage, syncAllGroups } from '../handler.js'
import { getOnConnectHandlers } from './plugins.js'
import { setBotStatus } from './db/accounts.js'
import { isAccountPremium } from './db/subscription.js'
import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'
import configBase from '../config.js'

const BAILEYS_VERSION_TIMEOUT_MS = 8000
const FALLBACK_BAILEYS_VERSION = [2, 3000, 1023223821]
const silentLogger = pino({ level: 'silent' })
const delay = (ms) => new Promise(r => setTimeout(r, ms))

// An unused pairing code/QR is just a dangling temp session: if the user
// never finishes entering it, the Mongo wa_auth docs + in-memory socket for
// that attempt would otherwise sit around forever (and a stray click on
// "Connect" would ask WhatsApp for yet another code/QR on top of it). These
// TTLs bound how long an unused code/QR is allowed to live before it's
// treated as expired and cleaned up. A session that already reached
// `connected` is never touched by this.
const PAIRING_CODE_TTL_MS = Number(process.env.PAIRING_CODE_TTL_MS || 90_000)
const QR_TTL_MS = Number(process.env.QR_TTL_MS || 45_000)

async function getBaileysVersion() {
    try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BAILEYS_VERSION_TIMEOUT_MS))
        const { version } = await Promise.race([fetchLatestBaileysVersion(), timeout])
        return version
    } catch {
        return FALLBACK_BAILEYS_VERSION
    }
}

class BotInstance {
    constructor(sessionId, botDoc, manager) {
        this.sessionId = sessionId
        this.botId = botDoc._id?.toString() || sessionId
        this.botDoc = botDoc
        this.manager = manager
        this.sock = null
        this.status = 'disconnected'
        this.qrDataUrl = null
        this.pairingCode = null
        this.lastError = null
        this._listenersAttached = false
        this._reconnectTimer = null
        this._stopped = false
        this._wantPairing = false
        this._phoneNumber = null
        this._pairingRestarts = 0
        this._qrRestarts = 0
        this._gen = 0
        this._openGeneration = 0
        this._starting = false
        this.waName = null
        this.waNumber = null
        this.profilePic = null
        this.enabled = botDoc.enabled !== false
        this._pairingIssuedAt = null
        this._qrIssuedAt = null
        this._expireTimer = null
    }

    _clearExpireTimer() {
        clearTimeout(this._expireTimer)
        this._expireTimer = null
    }

    _scheduleExpiry(ttlMs) {
        this._clearExpireTimer()
        const gen = this._gen
        this._expireTimer = setTimeout(() => {
            this._expireTimer = null
            if (gen !== this._gen) return
            this._handleUnusedExpiry().catch(() => {})
        }, ttlMs)
        this._expireTimer.unref?.()
    }

    /** True while the currently-shown pairing code/QR is still inside its TTL. */
    isPendingFresh() {
        if (this.status === 'pairing' && this.pairingCode && this._pairingIssuedAt) {
            return (Date.now() - this._pairingIssuedAt) < PAIRING_CODE_TTL_MS
        }
        if (this.status === 'qr' && this.qrDataUrl && this._qrIssuedAt) {
            return (Date.now() - this._qrIssuedAt) < QR_TTL_MS
        }
        return false
    }

    /**
     * A pairing code or QR that was never used to finish login. Cleans up
     * everything tied to that unused attempt: closes the socket, removes the
     * temp Mongo wa_auth docs, clears timers, and resets status -- but only
     * if login never actually completed. Never runs against a session that's
     * already connected/registered.
     */
    async _handleUnusedExpiry() {
        if (this.status === 'connected') return
        if (this.sock?.authState?.creds?.registered) return

        console.log(chalk.yellowBright(`[${this.sessionId}] Pairing/QR tidak dipakai, kedaluwarsa -- membersihkan session sementara`))
        this._gen++ // invalidate this generation so any in-flight connection.update/close handlers become no-ops
        clearTimeout(this._reconnectTimer)
        this._reconnectTimer = null
        await this._endSockQuiet()
        if (this._clearSession) await this._clearSession().catch(() => {})
        this.pairingCode = null
        this.qrDataUrl = null
        this._pairingIssuedAt = null
        this._qrIssuedAt = null
        this._wantPairing = false
        this._pairingRestarts = 0
        this._qrRestarts = 0
        this.status = 'disconnected'
        this.lastError = 'Kode pairing/QR kedaluwarsa (tidak digunakan). Klik Hubungkan lagi untuk minta kode baru.'
        await setBotStatus(this.sessionId, 'disconnected').catch(() => {})
    }

    buildConfig() {
        const identity = this.botDoc.identity || {}
        return {
            ...configBase,
            botId: this.sessionId,
            botName: identity.botName || this.botDoc.botName || 'ZoraBot',
            author: identity.author || configBase.author,
            title: identity.title || configBase.title,
            body: identity.body || configBase.body,
            packname: identity.packname || configBase.packname,
            thumbnail: identity.thumbnail || configBase.thumbnail,
            ownerNumber: identity.ownerNumber
                ? (Array.isArray(identity.ownerNumber) ? identity.ownerNumber : [identity.ownerNumber])
                : (this.botDoc.ownerNumber ? [this.botDoc.ownerNumber] : configBase.ownerNumber),
            idch: identity.idch || configBase.idch,
            groupId: identity.groupId || configBase.groupId,
            groupUrl: identity.groupUrl || configBase.groupUrl,
            channelUrl: identity.channelUrl || configBase.channelUrl,
            isJadibot: true
        }
    }

    async _endSockQuiet() {
        const s = this.sock
        this.sock = null
        this._listenersAttached = false
        if (!s) return
        try {
            s.ev.removeAllListeners('connection.update')
            s.ev.removeAllListeners('messages.upsert')
            s.ev.removeAllListeners('groups.update')
            s.ev.removeAllListeners('group-participants.update')
            s.ev.removeAllListeners('creds.update')
            s.end?.(undefined)
        } catch {}
    }

    /**
     * @param {{ phoneNumber?: string, forcePairing?: boolean, clearSessionFirst?: boolean, isRestart?: boolean }} opts
     */
    async start(opts = {}) {
        const {
            phoneNumber,
            forcePairing = false,
            clearSessionFirst = false,
            isRestart = false
        } = opts

        // Hindari start paralel
        if (this._starting) return
        this._starting = true
        const gen = ++this._gen

        try {
            this._stopped = false
            if (phoneNumber) this._phoneNumber = phoneNumber
            if (forcePairing) this._wantPairing = true

            clearTimeout(this._reconnectTimer)
            this._clearExpireTimer()
            await this._endSockQuiet()
            if (gen !== this._gen) return

            // Pairing/QR manual baru → session bersih (seperti hapus folder session)
            // Restart setelah 515 → JANGAN clear (kunci fix Stream Errored)
            if (!isRestart && (forcePairing || clearSessionFirst)) {
                const tmp = await useMongoAuthState(this.sessionId)
                await tmp.clearSession().catch(() => {})
                this.pairingCode = null
                this._pairingIssuedAt = null
                this._qrIssuedAt = null
                this._qrRestarts = 0
                this._pairingRestarts = 0
                console.log(chalk.cyanBright(`[${this.sessionId}] Session dibersihkan untuk pairing/QR baru`))
            }

            const authBundle = await useMongoAuthState(this.sessionId)
            this._clearSession = authBundle.clearSession
            this._saveCreds = authBundle.saveCreds

            if (!isRestart) {
                this.qrDataUrl = null
                this.lastError = null
            }

            if (this.pairingCode && isRestart) {
                this.status = 'pairing'
            } else {
                this.status = 'connecting'
            }
            await setBotStatus(this.sessionId, this.status).catch(() => {})

            const version = await getBaileysVersion()
            const cfg = this.buildConfig()

            // Sama seperti rezora connection.js
            const sock = makeWASocket({
                version,
                logger: silentLogger,
                printQRInTerminal: false,
                auth: {
                    creds: authBundle.state.creds,
                    keys: makeCacheableSignalKeyStore(authBundle.state.keys, silentLogger)
                },
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
                markOnlineOnConnect: true,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                getMessage: async () => undefined
            })

            if (gen !== this._gen || this._stopped) {
                try { sock.end?.(undefined) } catch {}
                return
            }

            this.sock = sock
            sock.isJadibotSession = true
            sock.sessionId = this.sessionId
            cfg.ownerAccountId = this.botDoc.ownerId?.toString?.() || this.botDoc.ownerId || null
            sock.botConfig = cfg
            // Cache premium plan on the socket so command path skips repeated DB hits.
            ;(async () => {
                try {
                    const ownerId = cfg.ownerAccountId
                    if (!ownerId) return
                    const prem = await isAccountPremium(String(ownerId))
                    cfg.isPremiumAccount = prem
                    sock.isPremiumAccount = prem
                    if (sock.botConfig) sock.botConfig.isPremiumAccount = prem
                } catch {}
            })()

            // PENTING (dari rezora): saveCreds SEBELUM pairing
            sock.ev.on('creds.update', authBundle.saveCreds)

            sock.ev.on('connection.update', async (update) => {
                if (gen !== this._gen) return
                const { connection, lastDisconnect, qr } = update

                if (qr && !this._wantPairing && !this._stopped) {
                    this.status = 'qr'
                    this.lastError = null
                    this.qrDataUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr)
                    this._qrIssuedAt = Date.now()
                    this._scheduleExpiry(QR_TTL_MS)
                    await setBotStatus(this.sessionId, 'qr').catch(() => {})
                    console.log(chalk.cyanBright(`[${this.sessionId}] QR siap`))
                }

                if (connection === 'open') {
                    // Baileys can emit a repeated open update. Do not run
                    // sync/onConnect twice for the same socket generation.
                    if (this._openGeneration === gen) return
                    this._openGeneration = gen
                    this._clearExpireTimer() // login succeeded -- this session must never be auto-cleaned as "unused"
                    this.status = 'connected'
                    this.qrDataUrl = null
                    this.pairingCode = null
                    this._pairingIssuedAt = null
                    this._qrIssuedAt = null
                    this.lastError = null
                    this._wantPairing = false
                    this._pairingRestarts = 0
                    this._qrRestarts = 0
                    try {
                        const u = sock.user || {}
                        this.waName = u.name || u.verifiedName || u.notify || null
                        const jid = u.id || ''
                        this.waNumber = String(jid).split(':')[0].split('@')[0] || null
                        try {
                            this.profilePic = await sock.profilePictureUrl(jid, 'image')
                        } catch {
                            this.profilePic = null
                        }
                    } catch {}
                    console.log(chalk.greenBright(`[${this.sessionId}] Connected`))
                    await setBotStatus(this.sessionId, 'connected').catch(() => {})
                    // PENTING: jangan block event loop / connection handler.
                    // Command handler (messages.upsert) sudah aktif sejak sebelum open.
                    // syncAllGroups + onConnect dijalankan background agar command langsung bisa diproses.
                    setImmediate(() => {
                        ;(async () => {
                            try {
                                await syncAllGroups(sock)
                            } catch (e) {
                                console.error(chalk.yellowBright(`[${this.sessionId}] syncAllGroups:`), e.message)
                            }
                            for (const plugin of getOnConnectHandlers()) {
                                try { await plugin.onConnect(sock, cfg) } catch (e) { console.error(e) }
                            }
                        })().catch(e => console.error(chalk.redBright(`[${this.sessionId}] onConnect:`), e.message))
                    })
                }

                if (connection === 'close') {
                    const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
                    const errMsg = lastDisconnect?.error?.message || 'Connection Closed'
                    console.log(chalk.yellowBright(`[${this.sessionId}] Close: ${errMsg} (${statusCode})`))

                    const wasRegistered = !!sock.authState?.creds?.registered
                    this.sock = null
                    this._listenersAttached = false

                    if (this._stopped || gen !== this._gen) return

                    // Sama seperti rezora: hanya logout yang TIDAK restart
                    if (statusCode === DisconnectReason.loggedOut) {
                        if (this._clearSession) await this._clearSession().catch(() => {})
                        this.status = 'disconnected'
                        this.lastError = 'logged_out'
                        const oid = this.botDoc?.ownerId?.toString?.() || this.botDoc?.ownerId
                        if (oid) pushNotification(oid, {
                            type: 'warning',
                            title: 'Bot terputus',
                            body: (this.botDoc.botName || 'Bot') + ' logout dari WhatsApp. Hubungkan ulang dari dashboard.',
                            link: '/connect'
                        }).catch(() => {})
                        this.pairingCode = null
                        this.qrDataUrl = null
                        this._wantPairing = false
                        await setBotStatus(this.sessionId, 'disconnected').catch(() => {})
                        return
                    }

                    // 515 / error lain → restart seperti startBot() di rezora
                    // JANGAN clear session, JANGAN hapus pairingCode -- KECUALI kalau ini
                    // udah beberapa kali reconnect sambil tetap belum registered: itu tandanya
                    // kode pairing yang lagi ditampilkan udah kadaluarsa (WA cuma nganggep
                    // kode valid buat socket yang mengeluarkannya; begitu socket itu mati
                    // sebelum sempat dipakai, kode itu mati juga). Restart pertama SETELAH
                    // kode dimasukkan itu normal (515), makanya dikasih 1x toleransi.
                    if (this.pairingCode && !wasRegistered) {
                        this._pairingRestarts++
                        if (this._pairingRestarts > 2) {
                            console.log(chalk.yellowBright(`[${this.sessionId}] Kode pairing kadaluarsa (${this._pairingRestarts}x reconnect tanpa registered), minta koneksi ulang.`))
                            this.pairingCode = null
                            this.status = 'disconnected'
                            this.lastError = 'Kode pairing kadaluarsa. Klik Hubungkan lagi untuk minta kode baru.'
                            this._wantPairing = false
                            this._pairingRestarts = 0
                            await setBotStatus(this.sessionId, 'disconnected').catch(() => {})
                            return
                        }
                        this.status = 'pairing'
                        this.lastError = null // 515 bukan error user-facing
                    } else if (this.pairingCode) {
                        this.status = 'pairing'
                        this.lastError = null
                    } else if (!wasRegistered) {
                        // QR flow yang gak pernah discan: batasi retry biar gak restart selamanya.
                        // Kalau udah pernah registered sebelumnya (wasRegistered true), ini TIDAK
                        // masuk sini -- artinya session lama tetap dipertahankan tanpa minta QR baru.
                        this._qrRestarts = (this._qrRestarts || 0) + 1
                        if (this._qrRestarts > 6) {
                            console.log(chalk.yellowBright(`[${this.sessionId}] QR kadaluarsa (${this._qrRestarts}x reconnect tanpa discan), berhenti auto-restart.`))
                            this.qrDataUrl = null
                            this.status = 'disconnected'
                            this.lastError = 'QR kedaluwarsa (tidak discan). Klik Hubungkan lagi untuk minta QR baru.'
                            this._qrRestarts = 0
                            await setBotStatus(this.sessionId, 'disconnected').catch(() => {})
                            return
                        }
                        this.status = 'connecting'
                        this.lastError = null
                    } else {
                        // Sudah pernah registered -- reconnect biasa, session dipertahankan, TANPA QR baru.
                        this._qrRestarts = 0
                        this.status = 'connecting'
                        this.lastError = null
                    }
                    await setBotStatus(this.sessionId, this.status).catch(() => {})

                    clearTimeout(this._reconnectTimer)
                    this._reconnectTimer = setTimeout(() => {
                        if (this._stopped) return
                        console.log(chalk.cyanBright(`[${this.sessionId}] Restart koneksi (session dipertahankan)`))
                        this.start({ isRestart: true }).catch(e =>
                            console.error(chalk.redBright(`[${this.sessionId}] restart:`), e.message)
                        )
                    }, 1500)
                }
            })

            sock.ev.on('groups.update', (event) => {
                Promise.resolve(onGroupsUpdate(sock, event)).catch(() => {})
            })
            sock.ev.on('group-participants.update', (event) => {
                // pakai botConfig live (bisa berubah setelah Bot Settings disimpan)
                const liveCfg = sock.botConfig || cfg
                Promise.resolve(onParticipantsUpdate(sock, liveCfg, event)).catch(() => {})
            })
            // Command handler aktif segera; config selalu dari sock.botConfig (identity premium)
            sock.ev.on('messages.upsert', (event) => {
                const liveCfg = sock.botConfig || cfg
                Promise.resolve(handleMessage(sock, liveCfg, event)).catch(e =>
                    console.error(chalk.redBright(`[${this.sessionId}] handleMessage:`), e?.message || e)
                )
            })
            this._listenersAttached = true

            await wrapSocket(sock)

            // Pairing code — hanya saat connect manual, bukan saat restart 515
            const needPairing = !isRestart && forcePairing && this._phoneNumber && !sock.authState.creds.registered
            if (needPairing) {
                this.status = 'pairing'
                await setBotStatus(this.sessionId, 'pairing').catch(() => {})
                try {
                    // rezora: langsung request tanpa delay panjang
                    await delay(500)
                    if (gen !== this._gen || this._stopped || !this.sock) return

                    const digits = String(this._phoneNumber).replace(/[^0-9]/g, '')
                    const code = await this.sock.requestPairingCode(digits)
                    const formatted = code && String(code).replace(/\D/g, '').length === 8
                        ? `${String(code).replace(/\D/g, '').slice(0, 4)}-${String(code).replace(/\D/g, '').slice(4)}`
                        : code
                    this.pairingCode = formatted || code
                    this._pairingIssuedAt = Date.now()
                    this._scheduleExpiry(PAIRING_CODE_TTL_MS)
                    this._pairingRestarts = 0
                    this.lastError = null
                    this.status = 'pairing'
                    await setBotStatus(this.sessionId, 'pairing').catch(() => {})
                    console.log(chalk.cyanBright(`[${this.sessionId}] Pairing code: ${this.pairingCode}`))
                } catch (e) {
                    this._clearExpireTimer()
                    this.lastError = e.message || 'Gagal pairing code'
                    this.status = 'disconnected'
                    console.error(chalk.redBright(`[${this.sessionId}] pairing failed:`), e.message)
                }
            } else if (!sock.authState.creds.registered && !this.pairingCode) {
                this.status = this._wantPairing ? 'pairing' : 'connecting'
            } else if (sock.authState.creds.registered) {
                this.status = 'connecting'
                console.log(chalk.whiteBright(`[${this.sessionId}] Session tersimpan, menunggu open...`))
            }
        } finally {
            this._starting = false
        }
    }

    async stop({ clearSession = false } = {}) {
        this._stopped = true
        this._wantPairing = false
        this._gen++
        clearTimeout(this._reconnectTimer)
        this._reconnectTimer = null
        this._clearExpireTimer()
        await this._endSockQuiet()
        this.status = 'disconnected'
        this.qrDataUrl = null
        this.pairingCode = null
        this._pairingIssuedAt = null
        this._qrIssuedAt = null
        this.lastError = null
        await setBotStatus(this.sessionId, 'disconnected').catch(() => {})
        if (clearSession && this._clearSession) {
            await this._clearSession().catch(() => {})
        } else if (clearSession) {
            const a = await useMongoAuthState(this.sessionId)
            await a.clearSession().catch(() => {})
        }
    }

    getPublicState() {
        return {
            sessionId: this.sessionId,
            botId: this.botId,
            status: this.status,
            qr: this.qrDataUrl,
            pairingCode: this.pairingCode,
            lastError: this.lastError,
            botName: this.botDoc.botName || 'ZoraBot',
            waName: this.waName,
            waNumber: this.waNumber,
            profilePic: this.profilePic,
            enabled: this.enabled !== false
        }
    }
}

class BotManager {
    constructor() {
        this.instances = new Map()
        this.resumeTimers = new Set()
    }

    get(sessionId) {
        return this.instances.get(sessionId)
    }

    async ensure(sessionId, botDoc) {
        let inst = this.instances.get(sessionId)
        if (!inst) {
            inst = new BotInstance(sessionId, botDoc, this)
            this.instances.set(sessionId, inst)
        } else {
            inst.botDoc = botDoc
        }
        return inst
    }

    async startBot(sessionId, botDoc, opts = {}) {
        const inst = await this.ensure(sessionId, botDoc)
        await inst.start(opts)
        return inst.getPublicState()
    }

    async stopBot(sessionId, opts = {}) {
        const inst = this.instances.get(sessionId)
        if (inst) {
            await inst.stop(opts)
            if (opts.remove) this.instances.delete(sessionId)
        }
    }

    getState(sessionId) {
        const inst = this.instances.get(sessionId)
        return inst ? inst.getPublicState() : { sessionId, status: 'disconnected' }
    }

    listStates() {
        return [...this.instances.values()].map(i => i.getPublicState())
    }

    async resumeAll() {
        try {
            const db = await getMongoDb()
            const bots = await db.collection(COLLECTIONS.BOTS).find({ status: 'connected', enabled: { $ne: false } }).toArray()
            console.log(chalk.cyanBright(`[manager] Resuming ${bots.length} bot...`))
            // Jangan nyambungin semua bot bareng di detik yang sama -- makin banyak bot,
            // makin berat beban CPU/RAM sekaligus dan makin gampang kena rate-limit
            // WhatsApp (banyak socket baru dari 1 server dalam waktu bersamaan). Kasih
            // jeda kecil antar bot biar naiknya bertahap.
            const RESUME_STAGGER_MS = 700
            let i = 0
            for (const bot of bots) {
                if (!bot.sessionId) continue
                const delayMs = i * RESUME_STAGGER_MS
                i++
                const timer = setTimeout(() => {
                    this.resumeTimers.delete(timer)
                    console.log(chalk.cyanBright(`[manager] Resuming ${bot.sessionId}`))
                    this.startBot(bot.sessionId, bot, { isRestart: true }).catch(e =>
                        console.error(chalk.redBright(`[manager] resume ${bot.sessionId}:`), e.message)
                    )
                }, delayMs)
                timer.unref?.()
                this.resumeTimers.add(timer)
            }
        } catch (e) {
            console.error(chalk.redBright('[manager] resumeAll:'), e.message)
        }
    }

    async closeAll() {
        for (const timer of this.resumeTimers) clearTimeout(timer)
        this.resumeTimers.clear()
        await Promise.all([...this.instances.values()].map(async (inst) => {
            inst._stopped = true
            inst._gen++
            clearTimeout(inst._reconnectTimer)
            inst._reconnectTimer = null
            clearTimeout(inst._expireTimer)
            inst._expireTimer = null
            await inst._endSockQuiet()
        }))
    }
}

export const botManager = new BotManager()
export default botManager
