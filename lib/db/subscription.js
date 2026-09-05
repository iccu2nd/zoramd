import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'
import { ObjectId } from 'mongodb'

// Premium = level AKUN (bukan per bot). botId subscription tetap diisi saat aktivasi
// agar isBotPremium() yang dipakai di banyak tempat tetap konsisten.

// Longer TTL: plan changes are rare and activation paths clear these caches.
// Short 5s TTL caused a Mongo round-trip on almost every command after any idle gap.
const CACHE_TTL_MS = Number(process.env.SUB_CACHE_TTL_MS || 5 * 60_000)
const accountCache = new Map()
const botCache = new Map()
const accountInflight = new Map()
const botInflight = new Map()

function readCache(cache, key) {
    const item = cache.get(String(key))
    if (!item || item.expiresAt <= Date.now()) {
        cache.delete(String(key))
        return null
    }
    return item.value
}

function writeCache(cache, key, value) {
    cache.set(String(key), { value, expiresAt: Date.now() + CACHE_TTL_MS })
    if (cache.size > 1000) {
        const first = cache.keys().next().value
        if (first) cache.delete(first)
    }
    return value
}

export async function getAccountSubscription(accountId) {
    const key = String(accountId)
    const cached = readCache(accountCache, key)
    if (cached) return cached
    let pending = accountInflight.get(key)
    if (!pending) {
        pending = (async () => {
            try {
                const db = await getMongoDb()
                const sub = await db.collection(COLLECTIONS.SUBSCRIPTIONS).findOne({ accountId: key })
                return writeCache(accountCache, key, sub || { accountId: key, plan: 'free', status: 'active', expiresAt: null })
            } finally {
                accountInflight.delete(key)
            }
        })()
        accountInflight.set(key, pending)
    }
    return pending
}

export async function isAccountPremium(accountId) {
    const sub = await getAccountSubscription(accountId)
    if (sub.plan !== 'premium') return false
    if (sub.status !== 'active') return false
    if (sub.expiresAt && new Date(sub.expiresAt).getTime() < Date.now()) return false
    return true
}

export async function getSubscription(botId) {
    const key = String(botId)
    const cached = readCache(botCache, key)
    if (cached) return cached
    let pending = botInflight.get(key)
    if (!pending) {
        pending = (async () => {
            try {
                const db = await getMongoDb()
                const sub = await db.collection(COLLECTIONS.SUBSCRIPTIONS).findOne({ botId: key })
                return writeCache(botCache, key, sub || { botId: key, plan: 'free', status: 'active', expiresAt: null })
            } finally {
                botInflight.delete(key)
            }
        })()
        botInflight.set(key, pending)
    }
    return pending
}

export async function isBotPremium(botId) {
    const sub = await getSubscription(botId)
    if (sub.plan !== 'premium') return false
    if (sub.status !== 'active') return false
    if (sub.expiresAt && new Date(sub.expiresAt).getTime() < Date.now()) return false
    return true
}

export async function activatePremium(botId, { months = 1, days } = {}) {
    const db = await getMongoDb()
    const current = await getSubscription(botId)
    const base = (current.plan === 'premium' && current.expiresAt && new Date(current.expiresAt) > new Date())
        ? new Date(current.expiresAt)
        : new Date()
    const durationMs = days ? days * 24 * 60 * 60 * 1000 : months * 30 * 24 * 60 * 60 * 1000
    const expiresAt = new Date(base.getTime() + durationMs)

    await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
        { botId },
        { $set: { botId, plan: 'premium', status: 'active', expiresAt, updatedAt: new Date() } },
        { upsert: true }
    )
    botCache.delete(String(botId))
    return { botId, plan: 'premium', status: 'active', expiresAt }
}

/** Aktifkan Premium di level akun + semua bot milik akun */
export async function activateAccountPremium(accountId, { months = 1, days } = {}) {
    const db = await getMongoDb()
    const aid = String(accountId)
    const current = await getAccountSubscription(aid)
    const base = (current.plan === 'premium' && current.expiresAt && new Date(current.expiresAt) > new Date())
        ? new Date(current.expiresAt)
        : new Date()
    const durationMs = days ? days * 24 * 60 * 60 * 1000 : months * 30 * 24 * 60 * 60 * 1000
    const expiresAt = new Date(base.getTime() + durationMs)

    await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
        { accountId: aid },
        { $set: { accountId: aid, plan: 'premium', status: 'active', expiresAt, updatedAt: new Date() } },
        { upsert: true }
    )
    accountCache.delete(aid)

    // Sync ke semua bot milik akun
    let bots = []
    try {
        bots = await db.collection(COLLECTIONS.BOTS).find({ ownerId: new ObjectId(aid) }).toArray()
    } catch {
        bots = await db.collection(COLLECTIONS.BOTS).find({ ownerId: aid }).toArray()
    }
    for (const b of bots) {
        await activatePremium(b._id.toString(), { months, days })
        // set exact same expiresAt
        await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
            { botId: b._id.toString() },
            { $set: { expiresAt, plan: 'premium', status: 'active', updatedAt: new Date() } },
            { upsert: true }
        )
    }

    return { accountId: aid, plan: 'premium', status: 'active', expiresAt }
}

export async function expireSubscription(botId) {
    const db = await getMongoDb()
    await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
        { botId },
        { $set: { plan: 'free', status: 'active', expiresAt: null, updatedAt: new Date() } },
        { upsert: true }
    )
    botCache.delete(String(botId))
}
