import 'dotenv/config'
import dns from 'dns'
import chalk from 'chalk'
import { ensureIndexes } from './lib/db/schema.js'
import { loadPlugins } from './lib/plugins.js'
import { createApp } from './server/app.js'
import botManager from './lib/botManager.js'
import { startAdsScheduler } from './lib/adsScheduler.js'
import config from './config.js'

dns.setDefaultResultOrder('ipv4first')

process.on('uncaughtException', (err) => console.error(chalk.redBright.bold('ERROR'), err))
process.on('unhandledRejection', (err) => console.error(chalk.redBright.bold('ERROR'), err))

const PORT = Number(process.env.PORT) || 3000
let httpServer = null

async function shutdown(signal) {
    console.log(chalk.yellowBright(`\n  ${signal} — graceful shutdown...`))
    try {
        if (httpServer) {
            await new Promise((resolve) => httpServer.close(() => resolve()))
        }
    } catch {}
    try {
        const { closeMongo } = await import('./lib/db/mongo.js')
        await closeMongo()
    } catch {}
    process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

async function main() {
    console.log()
    console.log(chalk.cyanBright.bold('  ZORABOT'))
    console.log(chalk.whiteBright('  Portable WhatsApp JadiBot Platform'))
    console.log()

    const hasMongo = Boolean(process.env.MONGODB_URI)
    if (!hasMongo) {
        console.warn(chalk.yellowBright('MONGODB_URI belum diset; dashboard berjalan dalam mode preview tanpa bot/database.'))
    } else {
        await ensureIndexes().catch(e =>
            console.error(chalk.redBright('Gagal membuat index MongoDB:'), e.message)
        )
        await loadPlugins()
    }

    // Start HTTP server (dashboard + API)
    const app = createApp()
    httpServer = app.listen(PORT, () => {
        console.log(chalk.greenBright(`  Dashboard & API  →  http://localhost:${PORT}`))
        console.log()
    })

    // Resume previously connected bots (session still valid in Mongo)
    if (hasMongo) {
        await botManager.resumeAll()
        startAdsScheduler()
    }
}

main().catch(e => {
    console.error(chalk.redBright('Fatal:'), e)
    process.exit(1)
})
