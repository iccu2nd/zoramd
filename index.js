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

async function main() {
    console.log()
    console.log(chalk.cyanBright.bold('  ZORABOT'))
    console.log(chalk.whiteBright('  Portable WhatsApp JadiBot Platform'))
    console.log()

    if (!process.env.MONGODB_URI) {
        console.error(chalk.redBright('MONGODB_URI belum diset. Lihat .env.example'))
        process.exit(1)
    }

    await ensureIndexes().catch(e =>
        console.error(chalk.redBright('Gagal membuat index MongoDB:'), e.message)
    )

    await loadPlugins()

    // Start HTTP server (dashboard + API)
    const app = createApp()
    app.listen(PORT, () => {
        console.log(chalk.greenBright(`  Dashboard & API  →  http://localhost:${PORT}`))
        console.log()
    })

    // Resume previously connected bots (session still valid in Mongo)
    await botManager.resumeAll()
    startAdsScheduler()
}

main().catch(e => {
    console.error(chalk.redBright('Fatal:'), e)
    process.exit(1)
})
