/**
 * Security helpers: headers, safe errors, cookie options
 */

export function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    // Jangan CSP ketat dulu (inline scripts di beberapa halaman) — block XSS via escapeHtml di FE
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    next()
}

export function isProduction() {
    return process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT
}

/** Nama cookie sesi. Jangan pakai "token" — rawan tabrakan sama cookie lama/app lain. */
export const AUTH_COOKIE_NAME = 'zora_sid'
export const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 3600 * 1000

/**
 * Apakah browser yang lagi request ini memakai HTTPS?
 * Acuan paling akurat: Origin/Referer halaman (itulah yang menentukan
 * cookie Secure diterima atau dibuang diam-diam).
 */
export function requestIsHttps(req) {
    if (!req) return isProduction()
    const origin = String(req.get?.('origin') || req.headers?.origin || '')
    const referer = String(req.get?.('referer') || req.headers?.referer || '')
    if (origin.startsWith('https://') || referer.startsWith('https://')) return true
    if (origin.startsWith('http://') || referer.startsWith('http://')) return false
    const xf = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
    if (xf === 'https') return true
    if (xf === 'http') return false
    if (req.secure) return true
    return String(process.env.APP_URL || '').startsWith('https://')
}

/**
 * Cookie options aman untuk JWT.
 *
 * `secure` HARUS mengikuti protokol yang dilihat browser. Kalau dipaksa true
 * padahal user buka lewat http, browser membuang Set-Cookie — login 200 tapi
 * /auth/me selalu 401 ("Sesi berakhir").
 */
export function authCookieOptions(req, extra = {}) {
    const forced = process.env.FORCE_SECURE_COOKIE
    const secure = forced === '0'
        ? false
        : (forced === '1' ? true : requestIsHttps(req))
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
        path: '/',
        ...extra
    }
}

/** Hapus cookie sesi baru + sisa cookie `token` lama (semua kombinasi Secure). */
export function clearAuthCookies(req, res) {
    const base = { path: '/', sameSite: 'lax' }
    res.clearCookie(AUTH_COOKIE_NAME, { ...base, secure: false })
    res.clearCookie(AUTH_COOKIE_NAME, { ...base, secure: true })
    res.clearCookie('token', { ...base, secure: false })
    res.clearCookie('token', { ...base, secure: true })
}

/** Jangan bocorin stack / internal message ke client di production */
export function publicError(err, fallback = 'Terjadi kesalahan') {
    if (!err) return fallback
    const msg = typeof err === 'string' ? err : (err.message || fallback)
    // Pesan yang aman untuk user (validasi, auth, bisnis)
    const safePrefixes = [
        'Email', 'Password', 'Kode', 'Token', 'Unauthorized', 'Akses',
        'Bot tidak', 'Order', 'Format', 'Tunggu', 'Terlalu', 'Nomor',
        'Custom', 'accessRule', 'Batas', 'Fitur', 'Session', 'Gagal',
        'Akun', 'Tidak ada', 'Teks iklan', 'orderId', 'wajib'
    ]
    if (safePrefixes.some(p => msg.startsWith(p) || msg.includes(p))) {
        return msg.slice(0, 300)
    }
    if (!isProduction()) return msg.slice(0, 300)
    return fallback
}

export function assertJwtSecret() {
    const secret = process.env.JWT_SECRET
    if (!secret || secret === 'zorabot-dev-secret-change-me' || secret.length < 24) {
        if (isProduction()) {
            console.error('[security] JWT_SECRET wajib diset (min 24 karakter) di production!')
            process.exit(1)
        }
        console.warn('[security] WARNING: JWT_SECRET default/lemah. Set JWT_SECRET di environment sebelum production.')
    }
}
