import { ObjectId } from 'mongodb'
import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

// --- Accounts (dashboard login) ---------------------------------------

export async function createAccount({ email, passwordHash, googleId, name }) {
    const db = await getMongoDb()
    const doc = {
        name: name || '',
        role: 'user',
        emailVerified: false,
        createdAt: new Date()
    }
    // Field opsional (email, passwordHash, googleId) SENGAJA tidak ditulis sama sekali
    // kalau kosong -- bukan diisi null. Index email_1 & googleId_1 itu unique+sparse,
    // dan "sparse" cuma skip dokumen yang field-nya beneran gak ada; kalau field-nya
    // ada tapi isinya null, tetap kena unique check dan bikin E11000 begitu akun kedua
    // yang gak punya googleId/email dibuat.
    if (email) doc.email = email
    if (passwordHash) doc.passwordHash = passwordHash
    if (googleId) doc.googleId = googleId
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


export async function listAllAccounts(limit = 200) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.ACCOUNTS)
        .find({}, { projection: { passwordHash: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
}

/**
 * Paginated account listing for admin (server-side search/filter/sort).
 * Never returns passwordHash or secrets.
 */
export async function listAccountsPaged({
    page = 1,
    limit = 20,
    q = '',
    role = '',
    sort = 'newest'
} = {}) {
    const db = await getMongoDb()
    const pageNum = Math.max(1, Math.min(10000, Number(page) || 1))
    const lim = Math.max(1, Math.min(50, Number(limit) || 20))
    const skip = (pageNum - 1) * lim

    const filter = {}
    const query = String(q || '').trim().slice(0, 80)
    if (query) {
        const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        filter.$or = [
            { email: { $regex: safe, $options: 'i' } },
            { name: { $regex: safe, $options: 'i' } }
        ]
    }
    if (role === 'admin' || role === 'user') {
        filter.role = role
    }

    const sortMap = {
        newest: { createdAt: -1 },
        oldest: { createdAt: 1 },
        email: { email: 1 }
    }
    const sortSpec = sortMap[sort] || sortMap.newest

    const col = db.collection(COLLECTIONS.ACCOUNTS)
    const [total, rows] = await Promise.all([
        col.countDocuments(filter),
        col.find(filter, { projection: { passwordHash: 0, googleId: 0 } })
            .sort(sortSpec)
            .skip(skip)
            .limit(lim)
            .toArray()
    ])

    return {
        total,
        page: pageNum,
        limit: lim,
        pages: Math.max(1, Math.ceil(total / lim)),
        accounts: rows.map(a => ({
            id: a._id.toString(),
            email: a.email || null,
            name: a.name || '',
            role: a.role || 'user',
            emailVerified: !!a.emailVerified,
            createdAt: a.createdAt
        }))
    }
}

export async function listAllBots(limit = 500) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.BOTS).find({}).sort({ createdAt: -1 }).limit(limit).toArray()
}

export async function listBotsPaged({ page = 1, limit = 20, q = '', status = '', sort = 'newest' } = {}) {
    const db = await getMongoDb()
    const pageNum = Math.max(1, Math.min(10000, Number(page) || 1))
    const lim = Math.max(1, Math.min(50, Number(limit) || 20))
    const skip = (pageNum - 1) * lim
    const filter = {}
    const query = String(q || '').trim().slice(0, 80)
    if (query) {
        const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        filter.$or = [
            { botName: { $regex: safe, $options: 'i' } },
            { sessionId: { $regex: safe, $options: 'i' } }
        ]
    }
    if (status) filter.status = String(status).slice(0, 32)
    const sortMap = {
        newest: { createdAt: -1 },
        oldest: { createdAt: 1 },
        status: { status: 1 }
    }
    const sortSpec = sortMap[sort] || sortMap.newest
    const col = db.collection(COLLECTIONS.BOTS)
    const [total, rows] = await Promise.all([
        col.countDocuments(filter),
        col.find(filter).sort(sortSpec).skip(skip).limit(lim).toArray()
    ])
    return {
        total,
        page: pageNum,
        limit: lim,
        pages: Math.max(1, Math.ceil(total / lim)),
        bots: rows.map(b => ({
            id: b._id.toString(),
            sessionId: b.sessionId,
            botName: b.botName,
            ownerId: b.ownerId?.toString(),
            status: b.status,
            enabled: b.enabled !== false,
            createdAt: b.createdAt
        }))
    }
}

export async function setAccountRole(accountId, role) {
    const db = await getMongoDb()
    const r = role === 'admin' ? 'admin' : 'user'
    await db.collection(COLLECTIONS.ACCOUNTS).updateOne(
        { _id: new ObjectId(accountId) },
        { $set: { role: r } }
    )
}

export async function deleteBotById(botId) {
    const db = await getMongoDb()
    const bot = await db.collection(COLLECTIONS.BOTS).findOne({ _id: new ObjectId(botId) })
    if (!bot) return false
    const sid = bot.sessionId
    await db.collection(COLLECTIONS.BOTS).deleteOne({ _id: new ObjectId(botId) })
    if (sid) {
        await db.collection(COLLECTIONS.BOT_SETTINGS).deleteMany({ botId: sid })
        await db.collection(COLLECTIONS.FEATURE_SETTINGS).deleteMany({ botId: sid })
        await db.collection(COLLECTIONS.BOT_DATA).deleteMany({ botId: sid })
        await db.collection(COLLECTIONS.WA_AUTH).deleteMany({ _id: { $regex: `^${sid}:` } })
        await db.collection(COLLECTIONS.SUBSCRIPTIONS).deleteMany({ botId: botId.toString() })
    }
    return true
}

export async function updateAccount(accountId, patch) {
    const db = await getMongoDb()
    await db.collection(COLLECTIONS.ACCOUNTS).updateOne(
        { _id: new ObjectId(accountId) },
        { $set: patch }
    )
}
