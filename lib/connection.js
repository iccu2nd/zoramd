import makeWASocket, {
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys'
import pino from 'pino'
import readline from 'readline'
import chalk from 'chalk'
import { groupMetadataCache } from './simple.js'
import { useMongoAuthState } from './mongoAuthState.js'

const BAILEYS_VERSION_TIMEOUT_MS = 8000
// Versi stabil terakhir yang diketahui aman, dipakai kalau fetchLatestBaileysVersion() hang/gagal
// (pernah kejadian di environment yang network-nya dibatasi).
const FALLBACK_BAILEYS_VERSION = [2, 3000, 1023223821]

async function getBaileysVersion() {
    try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BAILEYS_VERSION_TIMEOUT_MS))
        const { version } = await Promise.race([fetchLatestBaileysVersion(), timeout])
        return version
    } catch (e) {
        console.log(chalk.yellowBright(`fetchLatestBaileysVersion gagal/timeout (${e.message}), pakai versi fallback.`))
        return FALLBACK_BAILEYS_VERSION
    }
}

export async function createSocket(config) {
    console.log(chalk.whiteBright('Menyiapkan sesi...'))
    const sessionId = config.botId || 'default'
    const { state, saveCreds } = await useMongoAuthState(sessionId)

    console.log(chalk.whiteBright('Menyiapkan koneksi...'))
    const version = await getBaileysVersion()
    const silentLogger = pino({ level: 'silent' })

    const sock = makeWASocket({
        version,
        logger: silentLogger,
        printQRInTerminal: !config.usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, silentLogger)
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: config.generateHighQualityLinkPreview ?? false,
         cachedGroupMetadata: async (jid) => groupMetadataCache.get(jid)?.value || undefined,
        syncFullHistory: false,
    })

    // Simpan creds SEBELUM proses pairing code dimulai.
    // Kalau listener ini dipasang setelah requestPairingCode (seperti sebelumnya di index.js),
    // event creds.update yang terjadi selama proses pairing (mis. saat kode berhasil di-scan/diinput)
    // akan hilang karena belum ada listener yang menyimpannya ke MongoDB.
    // Akibatnya sesi yang tersimpan tidak lengkap dan WhatsApp langsung logout setelah connect.
    sock.ev.on('creds.update', saveCreds)

    if (config.usePairingCode && !sock.authState.creds.registered) {
        await requestPairingCode(sock)
    }

    return { sock, saveCreds }
}

async function requestPairingCode(sock) {
    console.log(chalk.whiteBright('Menghubungkan ke WhatsApp...'))

    console.log()
    console.log(chalk.cyanBright.bold('  Masukan nomor bot lalu tekan enter'))

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    const phoneNumber = await new Promise(resolve => {
        rl.once('line', line => resolve(line.trim()))
    })
    rl.close()

    const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''))
    console.log()
    console.log(chalk.whiteBright.bold('  Pairing Code'))
    console.log(chalk.cyanBright.bold('  ' + code))
    console.log()
}
