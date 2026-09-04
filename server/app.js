import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import apiRouter from './routes/api.js'
import { securityHeaders, isProduction } from '../lib/security.js'
import { rateLimit, clientIp } from '../lib/rateLimit.js'
import { findAccountById } from '../lib/db/accounts.js'
import { isAdminAccount, verifyToken } from './auth.js'

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
    // legacy
    '/chatlog': 'chatlog.html',
    '/upgrade': 'upgrade.html',
    '/orders': 'orders.html',
    '/account': 'account.html',
    '/database': 'database.html',
    '/admin': 'admin.html',
    '/admin/users': 'admin-users.html',
    '/admin/bots': 'admin-bots.html',
    '/admin/ads': 'admin-ads.html',
    '/terms': 'terms.html',
    '/privacy': 'privacy.html'
}

const AUTH_PAGES = new Set([
    '/dashboard', '/connect', '/bot-settings', '/feature-settings',
    '/chatlog', '/upgrade', '/orders', '/account', '/database'
])
const ADMIN_PAGES = new Set(['/admin', '/admin/users', '/admin/bots', '/admin/ads'])

function pageNotFound(res) {
    return res.status(404).sendFile(path.join(publicDir, '404.html'))
}

async function getPageAccount(req) {
    const header = req.headers.authorization || ''
    const cookieToken = req.cookies?.token
    const token = header.startsWith('Bearer ') ? header.slice(7) : cookieToken
    const payload = token ? verifyToken(token) : null
    if (!payload?.sub) return null
    try {
        return await findAccountById(payload.sub)
    } catch {
        return null
    }
}

function protectPage(route, handler) {
    return async (req, res, next) => {
        const account = await getPageAccount(req)
        if (ADMIN_PAGES.has(route)) {
            if (!account) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl))
            if (!isAdminAccount(account)) return pageNotFound(res)
        } else if (AUTH_PAGES.has(route) && !account) {
            return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl))
        }
        return handler(req, res, next)
    }
}

function buildCorsOrigin() {
    const raw = (process.env.CORS_ORIGINS || process.env.APP_URL || '').trim()
    if (!raw) {
        // Dev: izinkan origin request (credentials tetap aman karena SameSite)
        return true
    }
    const list = raw.split(',').map(s => s.trim()).filter(Boolean)
    return function (origin, cb) {
        // same-origin / server-to-server (no Origin header)
        if (!origin) return cb(null, true)
        if (list.includes(origin)) return cb(null, true)
        cb(new Error('CORS not allowed'))
    }
}

export function createApp() {
    const app = express()

    // Di belakang reverse proxy (Railway/Cloudflare)
    app.set('trust proxy', 1)

    app.use(securityHeaders)
    app.use(cors({
        origin: buildCorsOrigin(),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }))
    app.use(express.json({ limit: '1mb' }))
    app.use(cookieParser())

    app.use((req, res, next) => {
        res.removeHeader('X-Powered-By')
        next()
    })

    // Global API rate limit (anti-scrape / abuse) — longgar untuk user normal
    app.use('/api', rateLimit({
        windowMs: 60 * 1000,
        max: 180,
        keyFn: (req) => 'api:' + clientIp(req),
        message: 'Terlalu banyak request. Coba lagi sebentar.'
    }))


    app.use('/api', apiRouter)

    // Clean page routes are guarded before static files so private HTML never flashes
    // or becomes accessible through a direct /admin.html request.
    for (const [route, file] of Object.entries(PAGE_MAP)) {
        app.get(route, protectPage(route, (req, res) => {
            res.sendFile(path.join(publicDir, file))
        }))
    }

    // Legacy .html links redirect only after applying the same page policy.
    app.get(/^\/([a-z0-9-]+)\.html$/i, async (req, res) => {
        const base = '/' + req.params[0]
        if (req.params[0] === 'index') return res.redirect(301, '/')
        if (!PAGE_MAP[base]) return pageNotFound(res)
        return protectPage(base, (innerReq, innerRes) => innerRes.redirect(301, base))(req, res)
    })

    // Assets: css, js, images. HTML is intentionally handled by the routes above.
    app.use('/css', express.static(path.join(publicDir, 'css'), { maxAge: '7d', etag: true }))
    app.use('/js', express.static(path.join(publicDir, 'js'), { maxAge: '7d', etag: true }))
    app.use(express.static(publicDir, {
        maxAge: '1d',
        etag: true,
        index: false,
        extensions: false
    }))

    app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' })
        return pageNotFound(res)
    })

    app.use((err, req, res, next) => {
        console.error('[http]', err?.message || err)
        if (err?.message === 'CORS not allowed') {
            return res.status(403).json({ error: 'Origin tidak diizinkan' })
        }
        res.status(500).json({ error: 'Internal server error' })
    })

    return app
}
