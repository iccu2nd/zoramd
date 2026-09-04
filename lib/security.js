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

/** Cookie options aman untuk JWT */
export function authCookieOptions() {
    const secure = isProduction() || process.env.FORCE_SECURE_COOKIE === '1'
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: 7 * 24 * 3600 * 1000,
        path: '/'
    }
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
    const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET
    if (!secret || secret === 'zorabot-dev-secret-change-me' || secret.length < 24) {
        if (isProduction()) {
            console.error('[security] JWT_SECRET atau SESSION_SECRET wajib diset (min 24 karakter) di production!')
            process.exit(1)
        }
        console.warn('[security] WARNING: JWT_SECRET default/lemah. Set JWT_SECRET di environment sebelum production.')
    }
}
