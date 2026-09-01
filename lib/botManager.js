/**
 * BotManager – manages multiple Baileys sockets (one per sessionId / bot).
 * Avoids duplicate listeners, persists sessions in MongoDB, and exposes
 * status / QR / pairing code for the dashboard.
 */
import chalk from 'chalk'
import QRCode from 'qrcode'
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
        this.status = 'disconnected' // disconnected | connecting | qr | pairing | connected
        this.qrDataUrl = null
        this.pairingCode = null
        this.lastError = null
        this._listenersAttached = false
        this._reconnectTimer = null
        this._stopped = false
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
            usePairingCode: this.botDoc.usePairingCode !== false,
            isJadibot: true
        }
    }

    async start({ phoneNumber, forcePairing = false } = {}) {
        this._stopped = false
        if (this.sock) {
            // Already running – do not create duplicate listeners
            return
        }

        this.status = 'connecting'
        this.qrDataUrl = null
        this.pairingCode = null
        this.lastError = null
        await setBotStatus(this.sessionId, 'connecting').catch(() => {})

        const { state, saveCreds, clearSession } = await useMongoAuthState(this.sessionId)
        this._clearSession = clearSession
        this._saveCreds = saveCreds

        const version = await getBaileysVersion()
        const cfg = this.buildConfig()

        const sock = makeWASocket({
            version,
            logger: silentLogger,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, silentLogger)
            },
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false
        })

        this.sock = sock
        sock.isJadibotSession = true
        sock.sessionId = this.sessionId
        sock.botConfig = cfg

        // Always attach creds saver first
        sock.ev.on('creds.update', saveCreds)

        // Connection update
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                this.status = 'qr'
                try {
                    this.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 })
                } catch {
                    this.qrDataUrl = null
                }
                await setBotStatus(this.sessionId, 'qr').catch(() => {})
            }

            if (connection === 'open') {
                this.status = 'connected'
                this.qrDataUrl = null
                this.pairingCode = null
                this.lastError = null
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
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output?.statusCode
                    : lastDisconnect?.error?.output?.statusCode

                this.status = 'disconnected'
                this.sock = null
                this._listenersAttached = false
                await setBotStatus(this.sessionId, 'disconnected').catch(() => {})

                const shouldReconnect = statusCode !== DisconnectReason.loggedOut
                if (this._stopped) return

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(chalk.yellowBright(`[${this.sessionId}] Logged out – clearing session`))
                    if (this._clearSession) await this._clearSession().catch(() => {})
                    this.lastError = 'logged_out'
                    return
                }

                if (shouldReconnect) {
                    // Gentle reconnect – avoid aggressive loops
                    clearTimeout(this._reconnectTimer)
                    this._reconnectTimer = setTimeout(() => {
                        if (!this._stopped) this.start().catch(e => {
                            console.error(chalk.redBright(`[${this.sessionId}] reconnect error:`), e.message)
                        })
                    }, 5000)
                }
            }
        })

        // Message & group handlers (only once)
        if (!this._listenersAttached) {
            sock.ev.on('groups.update', (event) => onGroupsUpdate(sock, event))
            sock.ev.on('group-participants.update', (event) => onParticipantsUpdate(sock, cfg, event))
            sock.ev.on('messages.upsert', (event) => handleMessage(sock, cfg, event))
            this._listenersAttached = true
        }

        await wrapSocket(sock)

        // Pairing code path
        if ((forcePairing || cfg.usePairingCode) && !sock.authState.creds.registered) {
            if (phoneNumber) {
                try {
                    const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''))
                    this.pairingCode = code
                    this.status = 'pairing'
                    await setBotStatus(this.sessionId, 'pairing').catch(() => {})
                    console.log(chalk.cyanBright(`[${this.sessionId}] Pairing code: ${code}`))
                } catch (e) {
                    this.lastError = e.message
                    console.error(chalk.redBright(`[${this.sessionId}] pairing failed:`), e.message)
                }
            } else {
                // Wait for QR instead
                this.status = 'qr'
            }
        }
    }

    async stop({ clearSession = false } = {}) {
        // Keep _stopped=true so any late "close" event does not trigger reconnect
        this._stopped = true
        clearTimeout(this._reconnectTimer)
        this._reconnectTimer = null
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners('connection.update')
                this.sock.ev.removeAllListeners('messages.upsert')
                this.sock.ev.removeAllListeners('groups.update')
                this.sock.ev.removeAllListeners('group-participants.update')
                this.sock.ev.removeAllListeners('creds.update')
                // Prefer ws close; end() can throw on already-closed sockets
                if (typeof this.sock.end === 'function') {
                    this.sock.end(undefined)
                } else if (this.sock.ws?.close) {
                    this.sock.ws.close()
                }
            } catch {}
            this.sock = null
        }
        this._listenersAttached = false
        this.status = 'disconnected'
        this.qrDataUrl = null
        this.pairingCode = null
        await setBotStatus(this.sessionId, 'disconnected').catch(() => {})
        if (clearSession && this._clearSession) {
            await this._clearSession().catch(() => {})
        }
        // Do NOT reset _stopped here — start() will clear it when user connects again
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
        this.instances = new Map() // sessionId -> BotInstance
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
        for (const [id, inst] of this.instances) {
            out.push(inst.getPublicState())
        }
        return out
    }

    /** On process start: resume bots that were connected before restart */
    async resumeAll() {
        try {
            const db = await getMongoDb()
            const bots = await db.collection(COLLECTIONS.BOTS).find({
                status: { $in: ['connected', 'connecting', 'qr', 'pairing'] }
            }).toArray()
            for (const bot of bots) {
                const sid = bot.sessionId
                if (!sid) continue
                console.log(chalk.cyanBright(`[manager] Resuming bot ${sid}`))
                this.startBot(sid, bot).catch(e =>
                    console.error(chalk.redBright(`[manager] resume ${sid}:`), e.message)
                )
            }
        } catch (e) {
            console.error(chalk.redBright('[manager] resumeAll error:'), e.message)
        }
    }
}

export const botManager = new BotManager()
export default botManager
