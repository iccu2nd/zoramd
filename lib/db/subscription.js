import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'
import { ObjectId } from 'mongodb'

// Premium = level AKUN (bukan per bot). botId subscription tetap diisi saat aktivasi
// agar isBotPremium() yang dipakai di banyak tempat tetap konsisten.

export async function getAccountSubscription(accountId) {
    const db = await getMongoDb()
    const sub = await db.collection(COLLECTIONS.SUBSCRIPTIONS).findOne({ accountId: String(accountId) })
    return sub || { accountId: String(accountId), plan: 'free', status: 'active', expiresAt: null }
}

export async function isAccountPremium(accountId) {
    const sub = await getAccountSubscription(accountId)
    if (sub.plan !== 'premium') return false
    if (sub.status !== 'active') return false
    if (sub.expiresAt && new Date(sub.expiresAt).getTime() < Date.now()) return false
    return true
}

export async function getSubscription(botId) {
    const db = await getMongoDb()
    const sub = await db.collection(COLLECTIONS.SUBSCRIPTIONS).findOne({ botId })
    return sub || { botId, plan: 'free', status: 'active', expiresAt: null }
}

export async function isBotPremium(botId) {
    const sub = await getSubscription(botId)
    if (sub.plan !== 'premium') return false
    if (sub.status !== 'active') return false
    if (sub.expiresAt && new Date(sub.expiresAt).getTime() < Date.now()) return false
    return true
}

export async function activatePremium(botId, { months = 1 } = {}) {
    const db = await getMongoDb()
    const current = await getSubscription(botId)
    const base = (current.plan === 'premium' && current.expiresAt && new Date(current.expiresAt) > new Date())
        ? new Date(current.expiresAt)
        : new Date()
    const expiresAt = new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000)

    await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
        { botId },
        { $set: { botId, plan: 'premium', status: 'active', expiresAt, updatedAt: new Date() } },
        { upsert: true }
    )
    return { botId, plan: 'premium', status: 'active', expiresAt }
}

/** Aktifkan Premium di level akun + semua bot milik akun */
export async function activateAccountPremium(accountId, { months = 1 } = {}) {
    const db = await getMongoDb()
    const aid = String(accountId)
    const current = await getAccountSubscription(aid)
    const base = (current.plan === 'premium' && current.expiresAt && new Date(current.expiresAt) > new Date())
        ? new Date(current.expiresAt)
        : new Date()
    const expiresAt = new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000)

    await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
        { accountId: aid },
        { $set: { accountId: aid, plan: 'premium', status: 'active', expiresAt, updatedAt: new Date() } },
        { upsert: true }
    )

    // Sync ke semua bot milik akun
    let bots = []
    try {
        bots = await db.collection(COLLECTIONS.BOTS).find({ ownerId: new ObjectId(aid) }).toArray()
    } catch {
        bots = await db.collection(COLLECTIONS.BOTS).find({ ownerId: aid }).toArray()
    }
    for (const b of bots) {
        await activatePremium(b._id.toString(), { months })
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
}
