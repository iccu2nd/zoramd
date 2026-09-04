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

/**
 * Cookie options aman untuk JWT.
 *
 * `secure` HARUS ngikutin protokol koneksi yang sebenarnya (req.secure), bukan
 * cuma NODE_ENV. Kalau dipaksa `true` padahal request-nya kebaca sebagai http
 * (mis. domain/proxy yang belum full HTTPS), browser DIAM-DIAM MEMBUANG cookie
 * itu -- login keliatan sukses (200 + Set-Cookie terkirim), tapi cookie gak
 * pernah kesimpen, jadi request berikutnya ke /auth/me selalu 401 dan user
 * dilempar balik ke /login dengan "Sesi berakhir" terus-menerus walau baru aja
 * login. `req.secure` sendiri sudah akurat di belakang proxy karena app.js set
 * `trust proxy`, jadi otomatis ngikutin X-Forwarded-Proto.
 *
 * Pass `req` dari route handler supaya ini kebaca. FORCE_SECURE_COOKIE=1 tetap
 * bisa dipakai buat maksa secure kalau memang yakin semua traffic udah HTTPS.
 */
export function authCookieOptions(req) {
    const secure = process.env.FORCE_SECURE_COOKIE === '1'
        ? true
        : (req ? !!req.secure : isProduction())
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
    const secret = process.env.JWT_SECRET
    if (!secret || secret === 'zorabot-dev-secret-change-me' || secret.length < 24) {
        if (isProduction()) {
            console.error('[security] JWT_SECRET wajib diset (min 24 karakter) di production!')
            process.exit(1)
        }
        console.warn('[security] WARNING: JWT_SECRET default/lemah. Set JWT_SECRET di environment sebelum production.')
    }
}
