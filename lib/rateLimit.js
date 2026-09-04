/**
 * In-memory rate limiter (per-process).
 * Cocok untuk single-instance / Railway. Multi-instance butuh Redis.
 */

const buckets = new Map() // key -> { count, resetAt, blockedUntil }

const CLEAN_INTERVAL_MS = 60 * 1000
setInterval(() => {
    const now = Date.now()
    for (const [k, v] of buckets) {
        if (v.blockedUntil && v.blockedUntil < now && v.resetAt < now) buckets.delete(k)
        else if (!v.blockedUntil && v.resetAt < now) buckets.delete(k)
    }
}, CLEAN_INTERVAL_MS).unref?.()

/**
 * @param {string} key
 * @param {{ windowMs: number, max: number, blockMs?: number }} opts
 * @returns {{ ok: boolean, remaining: number, retryAfterSec: number }}
 */
export function consumeRateLimit(key, opts) {
    const windowMs = opts.windowMs || 60_000
    const max = opts.max || 30
    const blockMs = opts.blockMs || 0
    const now = Date.now()
    let b = buckets.get(key)

    if (b?.blockedUntil && b.blockedUntil > now) {
        return {
            ok: false,
            remaining: 0,
            retryAfterSec: Math.ceil((b.blockedUntil - now) / 1000)
        }
    }

    if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs, blockedUntil: 0 }
        buckets.set(key, b)
    }

    b.count++
    if (b.count > max) {
        if (blockMs > 0) b.blockedUntil = now + blockMs
        return {
            ok: false,
            remaining: 0,
            retryAfterSec: Math.ceil(((b.blockedUntil || b.resetAt) - now) / 1000)
        }
    }

    return {
        ok: true,
        remaining: Math.max(0, max - b.count),
        retryAfterSec: 0
    }
}

/**
 * Express middleware factory.
 * keyFn: (req) => string
 */
export function rateLimit(opts) {
    const {
        windowMs = 60_000,
        max = 60,
        blockMs = 0,
        keyFn = (req) => clientIp(req),
        message = 'Terlalu banyak permintaan. Coba lagi nanti.'
    } = opts || {}

    return function rateLimitMiddleware(req, res, next) {
        const key = keyFn(req)
        const result = consumeRateLimit(key, { windowMs, max, blockMs })
        res.setHeader('X-RateLimit-Remaining', String(result.remaining))
        if (!result.ok) {
            res.setHeader('Retry-After', String(result.retryAfterSec || 60))
            return res.status(429).json({ error: message, retryAfterSec: result.retryAfterSec })
        }
        next()
    }
}

export function clientIp(req) {
    return (req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64)
}
