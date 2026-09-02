import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import apiRouter from './routes/api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')

const PAGE_MAP = {
    '/': 'index.html',
    '/login': 'login.html',
    '/forgot-password': 'forgot-password.html',
    '/dashboard': 'dashboard.html',
    '/connect': 'connect.html',
    '/bot-settings': 'bot-settings.html',
    '/feature-settings': 'feature-settings.html',
    '/chatlog': 'chatlog.html',
    '/upgrade': 'upgrade.html',
    '/account': 'account.html',
    '/database': 'database.html',
    '/admin': 'admin.html',
    '/terms': 'terms.html',
    '/privacy': 'privacy.html'
}

export function createApp() {
    const app = express()

    app.use(cors({ origin: true, credentials: true }))
    app.use(express.json({ limit: '1mb' }))
    app.use(cookieParser())

    app.use((req, res, next) => {
        res.removeHeader('X-Powered-By')
        next()
    })

    app.use('/api', apiRouter)

    // Assets: css, js, images
    app.use('/css', express.static(path.join(publicDir, 'css'), { maxAge: '7d', etag: true }))
    app.use('/js', express.static(path.join(publicDir, 'js'), { maxAge: '7d', etag: true }))
    app.use(express.static(publicDir, { maxAge: '1d', etag: true }))

    // Clean page routes (no .html in URL)
    for (const [route, file] of Object.entries(PAGE_MAP)) {
        app.get(route, (req, res) => {
            res.sendFile(path.join(publicDir, file))
        })
    }

    // Legacy .html → clean URL
    app.get(/^\/([a-z0-9-]+)\.html$/i, (req, res) => {
        const base = '/' + req.params[0]
        if (PAGE_MAP[base]) return res.redirect(301, base)
        if (req.params[0] === 'index') return res.redirect(301, '/')
        res.status(404).end()
    })

    app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' })
        res.redirect('/')
    })

    app.use((err, req, res, next) => {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    })

    return app
}
