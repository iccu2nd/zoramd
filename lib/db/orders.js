import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

const ORDER_TTL_MS = 30 * 60 * 1000 // 30 menit

export async function createOrder({ accountId, botId, orderId, amount, paymentInfo, expiresAt, duration }) {
    const db = await getMongoDb()
    const doc = {
        accountId,
        botId,
        orderId,
        amount,
        duration: duration || '30d',
        paymentInfo,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : new Date(Date.now() + ORDER_TTL_MS),
        checkedAt: null,
        cancelledAt: null
    }
    await db.collection(COLLECTIONS.ORDERS).insertOne(doc)
    return doc
}

export async function findOrder(orderId) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.ORDERS).findOne({ orderId })
}

export async function findOrdersByAccount(accountId) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.ORDERS).find({ accountId }).sort({ createdAt: -1 }).toArray()
}

export async function markOrderChecked(orderId, status) {
    const db = await getMongoDb()
    await db.collection(COLLECTIONS.ORDERS).updateOne(
        { orderId },
        { $set: { status, checkedAt: new Date() } }
    )
}

export async function cancelOrder(orderId, accountId) {
    const db = await getMongoDb()
    const order = await db.collection(COLLECTIONS.ORDERS).findOne({ orderId, accountId })
    if (!order) return { ok: false, error: 'Order tidak ditemukan' }
    if (order.status === 'paid') return { ok: false, error: 'Order sudah dibayar' }
    if (order.status === 'cancelled') return { ok: true, already: true }
    await db.collection(COLLECTIONS.ORDERS).updateOne(
        { orderId },
        { $set: { status: 'cancelled', cancelledAt: new Date() } }
    )
    return { ok: true }
}

export function isOrderExpired(order) {
    if (!order) return true
    if (order.status === 'paid' || order.status === 'cancelled') return false
    const exp = order.expiresAt ? new Date(order.expiresAt).getTime() : 0
    return exp > 0 && Date.now() > exp
}

export { ORDER_TTL_MS }
