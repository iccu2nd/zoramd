import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'

const COL = 'notifications'
const MAX_PER_ACCOUNT = 50

export async function pushNotification(accountId, { type, title, body, link }) {
    if (!accountId) return
    try {
        const db = await getMongoDb()
        await db.collection(COL).insertOne({
            accountId: String(accountId),
            type: type || 'info',
            title: String(title || '').slice(0, 120),
            body: String(body || '').slice(0, 400),
            link: link || null,
            read: false,
            createdAt: new Date()
        })
        // trim old
        const list = await db.collection(COL)
            .find({ accountId: String(accountId) })
            .sort({ createdAt: -1 })
            .skip(MAX_PER_ACCOUNT)
            .project({ _id: 1 })
            .toArray()
        if (list.length) {
            await db.collection(COL).deleteMany({ _id: { $in: list.map(x => x._id) } })
        }
    } catch (e) {
        console.error('[notify]', e.message)
    }
}

export async function listNotifications(accountId, { limit = 20 } = {}) {
    const db = await getMongoDb()
    return db.collection(COL)
        .find({ accountId: String(accountId) })
        .sort({ createdAt: -1 })
        .limit(Math.min(50, limit))
        .toArray()
}

export async function markNotificationsRead(accountId, ids) {
    const db = await getMongoDb()
    const q = { accountId: String(accountId) }
    if (Array.isArray(ids) && ids.length) {
        const { ObjectId } = await import('mongodb')
        q._id = { $in: ids.filter(Boolean).map(id => {
            try { return new ObjectId(id) } catch { return null }
        }).filter(Boolean) }
    }
    await db.collection(COL).updateMany(q, { $set: { read: true } })
}

export async function countUnread(accountId) {
    const db = await getMongoDb()
    return db.collection(COL).countDocuments({ accountId: String(accountId), read: false })
}

export async function ensureNotificationIndexes() {
    try {
        const db = await getMongoDb()
        await db.collection(COL).createIndex({ accountId: 1, createdAt: -1 })
        await db.collection(COL).createIndex({ accountId: 1, read: 1 })
    } catch {}
}
