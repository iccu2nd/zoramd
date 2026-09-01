/**
 * BotManager – multi-session Baileys for ZoraBot
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
        this._pairingInProgress = false
        this._wantPairing = false
        this._phoneNumber = null
        this._startGeneration = 0
        this._restartCount = 0
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

    async _destroySock() {
        if (!this.sock) return
        try {
            this.sock.ev.removeAllListeners('connection.update')
            this.sock.ev.removeAllListeners('messages.upsert')
            this.sock.ev.removeAllListeners('groups.update')
            this.sock.ev.removeAllListeners('group-participants.update')
            this.sock.ev.removeAllListeners('creds.update')
            this.sock.end?.(undefined)
        } catch {}
        this.sock = null
        this._listenersAttached = false
    }

    async start({ phoneNumber, forcePairing = false, clearSessionFirst = false } = {}) {
        this._stopped = false
        this._wantPairing = !!forcePairing
        this._phoneNumber = phoneNumber || null
        const gen = ++this._startGeneration

        clearTimeout(this._reconnectTimer)
        await this._destroySock()
        await delay(400)
        if (gen !== this._startGeneration || this._stopped) return

        this.status = 'connecting'
        this.qrDataUrl = null
        this.pairingCode = null
        this.lastError = null
        this._pairingInProgress = false
        await setBotStatus(this.sessionId, 'connecting').catch(() => {})

        let authBundle = await useMongoAuthState(this.sessionId)
        this._clearSession = authBundle.clearSession
        this._saveCreds = authBundle.saveCreds

        // Pairing baru / session corrupt → selalu session bersih
        // "Stream Errored (restart required)" sering dari partial session
        if (forcePairing || clearSessionFirst) {
            await authBundle.clearSession().catch(() => {})
            authBundle = await useMongoAuthState(this.sessionId)
            this._clearSession = authBundle.clearSession
            this._saveCreds = authBundle.saveCreds
            console.log(chalk.cyanBright(`[${this.sessionId}] Session dibersihkan untuk pairing/QR baru`))
        }

        const version = await getBaileysVersion()
        const cfg = this.buildConfig()

        // Browser identity yang stabil untuk pairing & QR
        const browser = ['Ubuntu', 'Chrome', '20.0.04']

        const sock = makeWASocket({
            version,
            logger: silentLogger,
            printQRInTerminal: false,
            auth: {
                creds: authBundle.state.creds,
                keys: makeCacheableSignalKeyStore(authBundle.state.keys, silentLogger)
            },
            browser,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            getMessage: async () => undefined
        })

        if (gen !== this._startGeneration || this._stopped) {
            try { sock.end?.(undefined) } catch {}
            return
        }

        this.sock = sock
        sock.isJadibotSession = true
        sock.sessionId = this.sessionId
        sock.botConfig = cfg

        sock.ev.on('creds.update', authBundle.saveCreds)

        sock.ev.on('connection.update', async (update) => {
            if (gen !== this._startGeneration) return
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
                this._pairingInProgress = false
                this._restartCount = 0
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
                const err = lastDisconnect?.error
                const statusCode = (err instanceof Boom)
                    ? err.output?.statusCode
                    : (err?.output?.statusCode ?? err?.status)
                const errMsg = err?.message || err?.output?.payload?.message || 'Connection Closed'

                const wasSetup = this._pairingInProgress || this._wantPairing || this.status === 'pairing' || this.status === 'qr' || this.status === 'connecting'
                this.status = 'disconnected'
                this.sock = null
                this._listenersAttached = false
                this._pairingInProgress = false
                await setBotStatus(this.sessionId, 'disconnected').catch(() => {})

                if (this._stopped || gen !== this._startGeneration) return

                // Logout
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(chalk.yellowBright(`[${this.sessionId}] Logged out`))
                    if (this._clearSession) await this._clearSession().catch(() => {})
                    this.lastError = 'logged_out'
                    this.pairingCode = null
                    this.qrDataUrl = null
                    return
                }

                // 515 restart required – restart sekali (bukan pairing loop)
                const restartRequired = statusCode === DisconnectReason.restartRequired
                    || /restart required/i.test(errMsg)
                    || /Stream Errored/i.test(errMsg)

                this.lastError = errMsg
                console.log(chalk.yellowBright(`[${this.sessionId}] Close: ${errMsg} (${statusCode})`))

                if (wasSetup && this._wantPairing) {
                    // Jangan auto-loop pairing (user harus coba lagi). Kode pairing tetap ditampilkan jika ada.
                    return
                }

                if (restartRequired && this._restartCount < 2) {
                    this._restartCount++
                    clearTimeout(this._reconnectTimer)
                    this._reconnectTimer = setTimeout(() => {
                        if (!this._stopped) {
                            this.start({
                                phoneNumber: this._phoneNumber,
                                forcePairing: false,
                                clearSessionFirst: false
                            }).catch(() => {})
                        }
                    }, 3000)
                    return
                }

                // Reconnect lembut jika sebelumnya pernah connected / bukan setup pairing
                if (!wasSetup || !this._wantPairing) {
                    clearTimeout(this._reconnectTimer)
                    this._reconnectTimer = setTimeout(() => {
                        if (!this._stopped) {
                            this.start({}).catch(e =>
                                console.error(chalk.redBright(`[${this.sessionId}] reconnect:`), e.message)
                            )
                        }
                    }, 5000)
                }
            }
        })

        if (!this._listenersAttached) {
            sock.ev.on('groups.update', (event) => onGroupsUpdate(sock, event))
            sock.ev.on('group-participants.update', (event) => onParticipantsUpdate(sock, cfg, event))
            sock.ev.on('messages.upsert', (event) => handleMessage(sock, cfg, event))
            this._listenersAttached = true
        }

        await wrapSocket(sock)

        // Pairing code path
        if (forcePairing && phoneNumber && !sock.authState.creds.registered) {
            this._pairingInProgress = true
            this.status = 'pairing'
            await setBotStatus(this.sessionId, 'pairing').catch(() => {})

            try {
                // Tunggu WebSocket stabil
                await delay(3000)
                if (this._stopped || gen !== this._startGeneration || !this.sock) {
                    this.lastError = 'Koneksi terputus sebelum pairing code dibuat'
                    this.status = 'disconnected'
                    return
                }

                const digits = String(phoneNumber).replace(/[^0-9]/g, '')
                if (!/^\d{10,15}$/.test(digits)) {
                    this.lastError = 'Nomor tidak valid'
                    this.status = 'disconnected'
                    return
                }

                const code = await this.sock.requestPairingCode(digits)
                const formatted = code && String(code).length === 8
                    ? `${String(code).slice(0, 4)}-${String(code).slice(4)}`
                    : code

                this.pairingCode = formatted || code
                this.status = 'pairing'
                this.lastError = null
                await setBotStatus(this.sessionId, 'pairing').catch(() => {})
                console.log(chalk.cyanBright(`[${this.sessionId}] Pairing code: ${this.pairingCode}`))
            } catch (e) {
                this.lastError = e.message || 'Gagal membuat pairing code'
                this.status = 'disconnected'
                console.error(chalk.redBright(`[${this.sessionId}] pairing failed:`), e.message)
            }
        } else if (!forcePairing && !sock.authState.creds.registered) {
            this.status = 'connecting'
        } else if (sock.authState.creds.registered) {
            this.status = 'connecting'
            console.log(chalk.whiteBright(`[${this.sessionId}] Session tersimpan, menunggu open...`))
        }
    }

    async stop({ clearSession = false } = {}) {
        this._stopped = true
        this._wantPairing = false
        this._pairingInProgress = false
        this._startGeneration++
        clearTimeout(this._reconnectTimer)
        this._reconnectTimer = null
        await this._destroySock()
        this.status = 'disconnected'
        this.qrDataUrl = null
        this.pairingCode = null
        this.lastError = null
        await setBotStatus(this.sessionId, 'disconnected').catch(() => {})
        if (clearSession && this._clearSession) {
            await this._clearSession().catch(() => {})
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
            botName: this.botDoc.botName || 'ZoraBot'
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
        const out = []
        for (const [, inst] of this.instances) out.push(inst.getPublicState())
        return out
    }

    async resumeAll() {
        try {
            const db = await getMongoDb()
            const bots = await db.collection(COLLECTIONS.BOTS).find({ status: 'connected' }).toArray()
            for (const bot of bots) {
                if (!bot.sessionId) continue
                console.log(chalk.cyanBright(`[manager] Resuming ${bot.sessionId}`))
                this.startBot(bot.sessionId, bot, {}).catch(e =>
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
