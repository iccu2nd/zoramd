/**
 * BotManager – multi-session Baileys for ZoraBot dashboard.
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

    async start({ phoneNumber, forcePairing = false, clearSessionFirst = false } = {}) {
        this._stopped = false
        this._wantPairing = !!forcePairing
        this._phoneNumber = phoneNumber || null

        // Jika masih ada socket (termasuk yang stuck), hentikan dulu supaya tidak double / Connection Closed
        if (this.sock) {
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
            await delay(500)
        }

        this.status = 'connecting'
        this.qrDataUrl = null
        this.pairingCode = null
        this.lastError = null
        this._pairingInProgress = false
        await setBotStatus(this.sessionId, 'connecting').catch(() => {})

        let authBundle = await useMongoAuthState(this.sessionId)
        this._clearSession = authBundle.clearSession
        this._saveCreds = authBundle.saveCreds

        // Session corrupt / user minta pairing ulang → clear dulu
        if (clearSessionFirst || (forcePairing && authBundle.state.creds?.registered === false && authBundle.state.creds?.me)) {
            // keep
        }
        // Jika user connect manual dengan QR/pairing dan session belum registered,
        // pastikan state bersih bila sebelumnya sering Connection Closed
        if (!authBundle.state.creds?.registered && (forcePairing || !forcePairing)) {
            // biarkan Baileys generate QR/pairing dari state fresh
        }

        const version = await getBaileysVersion()
        const cfg = this.buildConfig()

        // Pairing code butuh browser identity yang stabil
        // Browser identity stabil untuk QR & pairing code
        const browser = ['Ubuntu', 'Chrome', '22.04.4']

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
            getMessage: async () => undefined
        })

        this.sock = sock
        sock.isJadibotSession = true
        sock.sessionId = this.sessionId
        sock.botConfig = cfg

        sock.ev.on('creds.update', authBundle.saveCreds)

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            // QR mode: tampilkan QR (jangan request pairing di sini)
            if (qr && !this._wantPairing && !this._stopped) {
                this.status = 'qr'
                this.lastError = null
                // Tampilkan QR lewat qrserver (ringan, tanpa canvas di server)
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
                    : err?.output?.statusCode
                const errMsg = err?.message || err?.output?.payload?.message || 'Connection Closed'

                // Jangan hapus pairingCode di UI terlalu cepat — biarkan user lihat error
                const wasPairing = this.status === 'pairing' || this._pairingInProgress

                this.status = 'disconnected'
                this.sock = null
                this._listenersAttached = false
                this._pairingInProgress = false
                await setBotStatus(this.sessionId, 'disconnected').catch(() => {})

                if (this._stopped) return

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(chalk.yellowBright(`[${this.sessionId}] Logged out – clear session`))
                    if (this._clearSession) await this._clearSession().catch(() => {})
                    this.lastError = 'logged_out'
                    this.pairingCode = null
                    this.qrDataUrl = null
                    return
                }

                // Saat proses pairing/QR, tampilkan alasan close (bukan reconnect agresif)
                if (wasPairing || this.status === 'qr' || this._wantPairing) {
                    this.lastError = errMsg
                    console.log(chalk.yellowBright(`[${this.sessionId}] Close saat setup: ${errMsg} (${statusCode})`))
                    // Reconnect sekali setelah jeda jika belum logged out (session bisa pulih)
                    if (statusCode !== DisconnectReason.loggedOut && !this._wantPairing) {
                        clearTimeout(this._reconnectTimer)
                        this._reconnectTimer = setTimeout(() => {
                            if (!this._stopped) {
                                this.start({ forcePairing: false }).catch(() => {})
                            }
                        }, 4000)
                    }
                    return
                }

                // Reconnect normal setelah connected sebelumnya
                clearTimeout(this._reconnectTimer)
                this._reconnectTimer = setTimeout(() => {
                    if (!this._stopped) {
                        this.start({}).catch(e =>
                            console.error(chalk.redBright(`[${this.sessionId}] reconnect:`), e.message)
                        )
                    }
                }, 5000)
            }
        })

        if (!this._listenersAttached) {
            sock.ev.on('groups.update', (event) => onGroupsUpdate(sock, event))
            sock.ev.on('group-participants.update', (event) => onParticipantsUpdate(sock, cfg, event))
            sock.ev.on('messages.upsert', (event) => handleMessage(sock, cfg, event))
            this._listenersAttached = true
        }

        await wrapSocket(sock)

        // --- Pairing code: tunggu socket siap, baru request ---
        if (forcePairing && phoneNumber && !sock.authState.creds.registered) {
            this._pairingInProgress = true
            this.status = 'pairing'
            await setBotStatus(this.sessionId, 'pairing').catch(() => {})

            try {
                // WA butuh websocket terbuka sebelum requestPairingCode
                await delay(2500)

                if (this._stopped || !this.sock) {
                    this.lastError = 'Koneksi terputus sebelum pairing code dibuat'
                    return
                }

                const digits = String(phoneNumber).replace(/[^0-9]/g, '')
                const code = await this.sock.requestPairingCode(digits)
                // Format kode agar mudah dibaca: XXXX-XXXX
                const formatted = code?.length === 8
                    ? `${code.slice(0, 4)}-${code.slice(4)}`
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
                // Coba tampilkan QR sebagai fallback
                this._wantPairing = false
            }
        } else if (!forcePairing && !sock.authState.creds.registered) {
            // Mode QR — tunggu event qr dari Baileys
            this.status = 'connecting'
            this.lastError = null
        } else if (sock.authState.creds.registered) {
            // Session sudah ada — tunggu open / reconnect otomatis
            this.status = 'connecting'
            console.log(chalk.whiteBright(`[${this.sessionId}] Memakai session tersimpan...`))
        }
    }

    async stop({ clearSession = false } = {}) {
        this._stopped = true
        this._wantPairing = false
        this._pairingInProgress = false
        clearTimeout(this._reconnectTimer)
        this._reconnectTimer = null
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners('connection.update')
                this.sock.ev.removeAllListeners('messages.upsert')
                this.sock.ev.removeAllListeners('groups.update')
                this.sock.ev.removeAllListeners('group-participants.update')
                this.sock.ev.removeAllListeners('creds.update')
                if (typeof this.sock.end === 'function') this.sock.end(undefined)
                else if (this.sock.ws?.close) this.sock.ws.close()
            } catch {}
            this.sock = null
        }
        this._listenersAttached = false
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
            // Hanya resume yang sebelumnya connected (punya session valid)
            const bots = await db.collection(COLLECTIONS.BOTS).find({
                status: 'connected'
            }).toArray()
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
