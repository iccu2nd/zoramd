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
import pino from 'pino'
import { Boom } from '@hapi/boom'
import { useMongoAuthState } from './mongoAuthState.js'
import wrapSocket from './simple.js'
import { onGroupsUpdate, onParticipantsUpdate, handleMessage, syncAllGroups } from '../handler.js'
import { getOnConnectHandlers } from './plugins.js'
import { setBotStatus } from './db/accounts.js'
import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'
import configBase from '../config.js'

const BAILEYS_VERSION_TIMEOUT_MS = 8000
const FALLBACK_BAILEYS_VERSION = [2, 3000, 1023223821]
const silentLogger = pino({ level: 'silent' })
const delay = (ms) => new Promise(r => setTimeout(r, ms))

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
        this._gen = 0
        this._starting = false
        this.waName = null
        this.waNumber = null
        this.profilePic = null
        this.enabled = botDoc.enabled !== false
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
            await this._endSockQuiet()
            if (gen !== this._gen) return

            // Pairing/QR manual baru → session bersih (seperti hapus folder session)
            // Restart setelah 515 → JANGAN clear (kunci fix Stream Errored)
            if (!isRestart && (forcePairing || clearSessionFirst)) {
                const tmp = await useMongoAuthState(this.sessionId)
                await tmp.clearSession().catch(() => {})
                this.pairingCode = null
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
            sock.botConfig = cfg

            // PENTING (dari rezora): saveCreds SEBELUM pairing
            sock.ev.on('creds.update', authBundle.saveCreds)

            sock.ev.on('connection.update', async (update) => {
                if (gen !== this._gen) return
                const { connection, lastDisconnect, qr } = update

                if (qr && !this._wantPairing && !this._stopped) {
                    this.status = 'qr'
                    this.lastError = null
                    this.qrDataUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr)
                    await setBotStatus(this.sessionId, 'qr').catch(() => {})
                    console.log(chalk.cyanBright(`[${this.sessionId}] QR siap`))
                }

                if (connection === 'open') {
                    this.status = 'connected'
                    this.qrDataUrl = null
                    this.pairingCode = null
                    this.lastError = null
                    this._wantPairing = false
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
                    try {
                        await syncAllGroups(sock)
                        for (const plugin of getOnConnectHandlers()) {
                            try { await plugin.onConnect(sock, cfg) } catch (e) { console.error(e) }
                        }
                    } catch (e) {
                        console.error(chalk.redBright(`[${this.sessionId}] onConnect:`), e.message)
                    }
                }

                if (connection === 'close') {
                    const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
                    const errMsg = lastDisconnect?.error?.message || 'Connection Closed'
                    console.log(chalk.yellowBright(`[${this.sessionId}] Close: ${errMsg} (${statusCode})`))

                    this.sock = null
                    this._listenersAttached = false

                    if (this._stopped || gen !== this._gen) return

                    // Sama seperti rezora: hanya logout yang TIDAK restart
                    if (statusCode === DisconnectReason.loggedOut) {
                        if (this._clearSession) await this._clearSession().catch(() => {})
                        this.status = 'disconnected'
                        this.lastError = 'logged_out'
                        this.pairingCode = null
                        this.qrDataUrl = null
                        this._wantPairing = false
                        await setBotStatus(this.sessionId, 'disconnected').catch(() => {})
                        return
                    }

                    // 515 / error lain → restart seperti startBot() di rezora
                    // JANGAN clear session, JANGAN hapus pairingCode
                    if (this.pairingCode) {
                        this.status = 'pairing'
                        this.lastError = null // 515 bukan error user-facing
                    } else {
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

            sock.ev.on('groups.update', (event) => onGroupsUpdate(sock, event))
            sock.ev.on('group-participants.update', (event) => onParticipantsUpdate(sock, cfg, event))
            sock.ev.on('messages.upsert', (event) => handleMessage(sock, cfg, event))
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
                    this.lastError = null
                    this.status = 'pairing'
                    await setBotStatus(this.sessionId, 'pairing').catch(() => {})
                    console.log(chalk.cyanBright(`[${this.sessionId}] Pairing code: ${this.pairingCode}`))
                } catch (e) {
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
        await this._endSockQuiet()
        this.status = 'disconnected'
        this.qrDataUrl = null
        this.pairingCode = null
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
            for (const bot of bots) {
                if (!bot.sessionId) continue
                console.log(chalk.cyanBright(`[manager] Resuming ${bot.sessionId}`))
                this.startBot(bot.sessionId, bot, { isRestart: true }).catch(e =>
                    console.error(chalk.redBright(`[manager] resume ${bot.sessionId}:`), e.message)
                )
            }
        } catch (e) {
            console.error(chalk.redBright('[manager] resumeAll:'), e.message)
        }
    }
}

export const botManager = new BotManager()
export default botManager
