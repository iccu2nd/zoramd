import { ObjectId } from 'mongodb'
import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

// --- Accounts (dashboard login) ---------------------------------------

export async function createAccount({ email, passwordHash, googleId, name }) {
    const db = await getMongoDb()
    const doc = {
        email: email || null,
        passwordHash: passwordHash || null,
        googleId: googleId || null,
        name: name || '',
        createdAt: new Date()
    }
    const { insertedId } = await db.collection(COLLECTIONS.ACCOUNTS).insertOne(doc)
    return { _id: insertedId, ...doc }
}

export async function findAccountByEmail(email) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.ACCOUNTS).findOne({ email })
}

export async function findAccountByGoogleId(googleId) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.ACCOUNTS).findOne({ googleId })
}

export async function findAccountById(accountId) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.ACCOUNTS).findOne({ _id: new ObjectId(accountId) })
}

// --- Bots ---------------------------------------------------------------
// Setiap dokumen bot itu punya satu ownerId. Semua fungsi di bawah yang
// mengambil/ubah bot WAJIB dilewatin ownerId dan dipakai buat filter query
// -- bukan cuma dicek belakangan -- supaya user A gak akan pernah bisa
// kebaca/ubah bot milik user B lewat bug logic di layer atas.

export async function createBot({ ownerId, sessionId, botName, ownerNumber }) {
    const db = await getMongoDb()
    const doc = {
        ownerId: new ObjectId(ownerId),
        sessionId,
        botName: botName || 'ZoraBot',
        ownerNumber: ownerNumber || null,
        identity: null,   // custom identity (premium only, ditegakkan di layer settings)
        status: 'disconnected',
        createdAt: new Date()
    }
    const { insertedId } = await db.collection(COLLECTIONS.BOTS).insertOne(doc)
    return { _id: insertedId, ...doc }
}

export async function findBotsByOwner(ownerId) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.BOTS).find({ ownerId: new ObjectId(ownerId) }).toArray()
}

// Dipakai tiap kali dashboard mau baca/ubah SATU bot spesifik.
// ownerId di sini bukan opsional -- inilah yang menegakkan "user cuma bisa akses bot miliknya sendiri".
export async function findOwnedBot(botId, ownerId) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.BOTS).findOne({
        _id: new ObjectId(botId),
        ownerId: new ObjectId(ownerId)
    })
}

export async function findBotBySessionId(sessionId) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.BOTS).findOne({ sessionId })
}

export async function updateOwnedBot(botId, ownerId, patch) {
    const db = await getMongoDb()
    const res = await db.collection(COLLECTIONS.BOTS).updateOne(
        { _id: new ObjectId(botId), ownerId: new ObjectId(ownerId) },
        { $set: patch }
    )
    return res.matchedCount > 0
}

export async function setBotStatus(sessionId, status) {
    const db = await getMongoDb()
    await db.collection(COLLECTIONS.BOTS).updateOne({ sessionId }, { $set: { status } })
}
