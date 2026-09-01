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

    // Halaman login terpisah (endpoint /login dan /login.html)
    app.get(['/login', '/login.html'], (req, res) => {
        res.sendFile(path.join(publicDir, 'login.html'))
    })

    // Static assets (css, js, dll.)
    app.use(express.static(publicDir))

    // Dashboard SPA fallback — jangan override /login
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/login')) {
            return next()
        }
        // file statis yang tidak ketemu
        if (path.extname(req.path)) {
            return res.status(404).end()
        }
        res.sendFile(path.join(publicDir, 'index.html'))
    })

    app.use((err, req, res, next) => {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    })

    return app
}
