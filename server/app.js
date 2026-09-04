import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { securityHeaders, isProduction, publicError } from '../lib/security.js'
import { rateLimit, clientIp } from '../lib/rateLimit.js'
import { verifyToken, isAdminAccount } from './auth.js'
import { findAccountById } from '../lib/db/accounts.js'

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
    '/admin/errors': 'admin-errors.html',
    '/terms': 'terms.html',
    '/privacy': 'privacy.html'
}

const ADMIN_ROUTES = new Set(['/admin', '/admin/users', '/admin/bots', '/admin/ads', '/admin/errors'])
const LEGACY_PAGE_MAP = {
    '/admin-users': '/admin/users',
    '/admin-bots': '/admin/bots',
    '/admin-ads': '/admin/ads',
    '/admin-errors': '/admin/errors'
}

function buildCorsOrigin() {
    const raw = (process.env.CORS_ORIGINS || process.env.APP_URL || '').trim()
    if (!raw) {
        // Same-origin tetap berjalan; production tidak boleh membuka credentialed CORS.
        return isProduction() ? false : true
    }
    const list = raw.split(',').map(s => s.trim()).filter(Boolean)
    return function (origin, cb) {
        // same-origin / server-to-server (no Origin header)
        if (!origin) return cb(null, true)
        if (list.includes(origin)) return cb(null, true)
        cb(new Error('CORS not allowed'))
    }
}

function sendNotFound(res) {
    const file = path.join(publicDir, '404.html')
    return res.status(404).sendFile(file, (err) => {
        if (err && !res.headersSent) res.status(404).type('text/plain').send('Not Found')
    })
}

async function requireAdminPage(req, res, next) {
    try {
        const token = req.cookies?.zora_sid || req.cookies?.token
        const payload = token && verifyToken(token)
        if (!payload?.sub) return sendNotFound(res)
        const account = await findAccountById(payload.sub)
        if (!isAdminAccount(account)) return sendNotFound(res)
        req.account = account
        next()
    } catch {
        return sendNotFound(res)
    }
}

function sameOriginGuard(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
    const origin = req.get('origin')
    if (!origin) return next()
    const allowed = (process.env.CORS_ORIGINS || process.env.APP_URL || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    try {
        const parsed = new URL(origin)
        const sameHost = parsed.host === req.get('host')
        if (sameHost || allowed.includes(origin)) return next()
    } catch {}
    return res.status(403).json({ error: 'Origin tidak diizinkan' })
}

export function createApp() {
    const app = express()

    // Di belakang reverse proxy (Railway/Cloudflare)
    const proxyHops = Number(process.env.TRUST_PROXY_HOPS)
    app.set('trust proxy', Number.isFinite(proxyHops) && proxyHops >= 0 ? proxyHops : 1)

    app.use(securityHeaders)
    app.use(cors({
        origin: buildCorsOrigin(),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }))
    app.use(express.json({ limit: '1mb' }))
    app.use(cookieParser())
    app.use('/api', sameOriginGuard)

    app.use((req, res, next) => {
        res.removeHeader('X-Powered-By')
        next()
    })

    // Semua handler lama mengembalikan error JSON masing-masing. Sanitasi error
    // 5xx di satu tempat agar detail Mongo/provider tidak bocor di production.
    app.use('/api', (req, res, next) => {
        const sendJson = res.json.bind(res)
        res.json = (body) => {
            if (res.statusCode >= 500 && body && typeof body === 'object' && body.error) {
                body = { ...body, error: publicError(body.error) }
            }
            return sendJson(body)
        }
        next()
    })

    // Global API rate limit (anti-scrape / abuse) — longgar untuk user normal
    app.use('/api', rateLimit({
        windowMs: 60 * 1000,
        max: 180,
        keyFn: (req) => 'api:' + clientIp(req),
        message: 'Terlalu banyak request. Coba lagi sebentar.'
    }))


    // API route tree imports Mongo/plugin/Baileys modules. Load it lazily so
    // the HTTP server can listen and answer health/static requests first.
    let apiRouterPromise = null
    app.use('/api', async (req, res, next) => {
        try {
            apiRouterPromise ||= import('./routes/api.js').then(mod => mod.default)
            const apiRouter = await apiRouterPromise
            return apiRouter(req, res, next)
        } catch (err) {
            return next(err)
        }
    })

    // Assets: css, js, images
    app.use('/css', express.static(path.join(publicDir, 'css'), { maxAge: '7d', etag: true }))
    app.use('/js', express.static(path.join(publicDir, 'js'), { maxAge: '7d', etag: true }))

    // Clean page routes (no .html in URL)
    for (const [route, file] of Object.entries(PAGE_MAP)) {
        app.get(route, (req, res) => {
            const serve = () => res.sendFile(path.join(publicDir, file))
            if (ADMIN_ROUTES.has(route)) return requireAdminPage(req, res, serve)
            return serve()
        })
    }

    // Legacy .html → clean URL
    app.get(/^\/([a-z0-9-]+)\.html$/i, (req, res) => {
        const base = '/' + req.params[0]
        const cleanRoute = PAGE_MAP[base] || LEGACY_PAGE_MAP[base]
        if (cleanRoute) {
            if (ADMIN_ROUTES.has(cleanRoute)) {
                return requireAdminPage(req, res, () => res.redirect(301, cleanRoute))
            }
            return res.redirect(301, cleanRoute)
        }
        if (req.params[0] === 'index') return res.redirect(301, '/')
        return sendNotFound(res)
    })

    // HTML files must not bypass the clean-route authorization above.
    app.use(express.static(publicDir, { maxAge: '1d', etag: true }))

    app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' })
        return sendNotFound(res)
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
