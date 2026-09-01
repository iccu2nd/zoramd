import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

// Ini khusus buat order pembayaran Upgrade Plan (Premium Rp25.000/bulan) lewat SociaBuzz
// -- dipisah dari `_donate.js` yang punya penyimpanan transaksi sendiri (sociabuzz-transactions.json)
// buat fitur donasi WA yang gak ada hubungannya sama langganan Premium.
// Alur cek status di sini manual (dashboard nekan "Cek Status Pembayaran"), BUKAN automatic polling.

export async function createOrder({ accountId, botId, orderId, amount, paymentInfo }) {
    const db = await getMongoDb()
    const doc = {
        accountId,
        botId,
        orderId,
        amount,
        paymentInfo,
        status: 'pending',
        createdAt: new Date(),
        checkedAt: null
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

// Dipanggil cuma waktu user nekan tombol "Cek Status Pembayaran" secara manual di dashboard.
export async function markOrderChecked(orderId, status) {
    const db = await getMongoDb()
    await db.collection(COLLECTIONS.ORDERS).updateOne(
        { orderId },
        { $set: { status, checkedAt: new Date() } }
    )
}
