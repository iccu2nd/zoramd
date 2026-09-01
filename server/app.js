import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import apiRouter from './routes/api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')

export function createApp() {
    const app = express()

    app.use(cors({ origin: true, credentials: true }))
    app.use(express.json({ limit: '1mb' }))
    app.use(cookieParser())

    // Never expose env / secrets
    app.use((req, res, next) => {
        res.removeHeader('X-Powered-By')
        next()
    })

    app.use('/api', apiRouter)

    // Static dashboard
    app.use(express.static(publicDir))

    // SPA fallback
    app.get('*', (req, res) => {
        res.sendFile(path.join(publicDir, 'index.html'))
    })

    app.use((err, req, res, next) => {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    })

    return app
}
