import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import apiRouter, { isAdminAccount } from './routes/api.js'
import { securityHeaders, isProduction } from '../lib/security.js'
import { rateLimit, clientIp } from '../lib/rateLimit.js'
import { verifyToken } from './auth.js'
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
    '/terms': 'terms.html',
    '/privacy': 'privacy.html'
}

// Route yang butuh login (akun valid apa saja)
const AUTH_REQUIRED_ROUTES = new Set([
    '/dashboard', '/connect', '/bot-settings', '/feature-settings',
    '/chatlog', '/upgrade', '/orders', '/account', '/database'
])

// Route admin-only — disembunyikan total (404) dari non-admin, bukan sekadar redirect,
// supaya tidak "kelihatan sebentar lalu hilang".
const ADMIN_ROUTES = new Set(['/admin', '/admin/users', '/admin/bots', '/admin/ads'])

// Nama file .html mentah dari route yang dilindungi — dipakai untuk mencegah bypass
// lewat static file server (mis. GET /admin-ads.html langsung, tanpa lewat pageGuard).
const PROTECTED_HTML_FILES = new Set(
    [...ADMIN_ROUTES, ...AUTH_REQUIRED_ROUTES].map(r => PAGE_MAP[r]).filter(Boolean)
)

function getTokenFromReq(req) {
    const header = req.headers.authorization || ''
    if (header.startsWith('Bearer ')) return header.slice(7)
    return req.cookies?.token || null
}

/** Resolve akun dari request (token cookie/header), tanpa melempar kalau tidak ada/invalid. */
async function resolveAccount(req) {
    const token = getTokenFromReq(req)
    if (!token) return null
    const payload = verifyToken(token)
    if (!payload?.sub) return null
    try {
        return await findAccountById(payload.sub)
    } catch {
        return null
    }
}

function send404Page(res) {
    res.status(404).sendFile(path.join(publicDir, '404.html'))
}

/**
 * Guard server-side untuk halaman yang butuh login/admin.
 * Validasi dilakukan SEBELUM file HTML dikirim — bukan hanya sembunyikan
 * menu di frontend — supaya halaman admin/protected tidak sempat ter-render
 * untuk user yang tidak berhak.
 */
async function pageGuard(req, res, next) {
    const route = req.path
    const isAdminRoute = ADMIN_ROUTES.has(route)
    const isAuthRoute = AUTH_REQUIRED_ROUTES.has(route)
    if (!isAdminRoute && !isAuthRoute) return next()

    const account = await resolveAccount(req)

    if (isAdminRoute) {
        // Route admin: guest ATAU user biasa dapat 404 — jangan bocorkan bahwa route ini ada.
        if (!isAdminAccount(account)) return send404Page(res)
        return next()
    }

    // Route butuh login biasa: guest diarahkan ke halaman login.
    if (!account) return res.redirect('/login')
    return next()
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

    // Cegah akses langsung ke file .html mentah dari halaman terproteksi
    // (mis. /admin-ads.html) supaya tidak melewati pageGuard di bawah — arahkan
    // ke clean URL yang sama, yang lewat guard sebelum file dikirim.
    app.use((req, res, next) => {
        const file = req.path.split('/').pop()
        if (file && PROTECTED_HTML_FILES.has(file)) {
            return res.redirect(301, '/' + file.replace(/\.html$/i, ''))
        }
        next()
    })

    // Assets: css, js, images
    app.use('/css', express.static(path.join(publicDir, 'css'), { maxAge: '7d', etag: true }))
    app.use('/js', express.static(path.join(publicDir, 'js'), { maxAge: '7d', etag: true }))
    app.use(express.static(publicDir, { maxAge: '1d', etag: true }))

    // Clean page routes (no .html in URL)
    for (const [route, file] of Object.entries(PAGE_MAP)) {
        app.get(route, pageGuard, (req, res) => {
            res.sendFile(path.join(publicDir, file))
        })
    }

    // Legacy .html → clean URL
    app.get(/^\/([a-z0-9-]+)\.html$/i, (req, res) => {
        const base = '/' + req.params[0]
        if (PAGE_MAP[base]) return res.redirect(301, base)
        if (req.params[0] === 'index') return res.redirect(301, '/')
        send404Page(res)
    })

    app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' })
        send404Page(res)
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
