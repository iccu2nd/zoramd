import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

// Ini status langganan Free/Premium punya BOT (dari Priorita 4), beda sama
// `user.premium` di lib/database.js yang itu status VIP in-bot buat kontak WhatsApp
// (fitur ekonomi/RPG). Jangan digabung -- dua konsep yang gak berhubungan.

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

export async function expireSubscription(botId) {
    const db = await getMongoDb()
    await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
        { botId },
        { $set: { plan: 'free', status: 'active', expiresAt: null, updatedAt: new Date() } },
        { upsert: true }
    )
}
