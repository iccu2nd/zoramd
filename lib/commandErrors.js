import { getMongoDb } from './db/mongo.js'

const COL = 'command_errors'
const MAX_PER_BOT = 40

export async function logCommandError({ botId, sessionId, cmd, message, stack }) {
    if (!botId && !sessionId) return
    try {
        const db = await getMongoDb()
        await db.collection(COL).insertOne({
            botId: String(botId || sessionId),
            sessionId: sessionId || botId,
            cmd: String(cmd || '').slice(0, 40),
            message: String(message || '').slice(0, 500),
            stack: stack ? String(stack).slice(0, 800) : null,
            createdAt: new Date()
        })
        const old = await db.collection(COL)
            .find({ botId: String(botId || sessionId) })
            .sort({ createdAt: -1 })
            .skip(MAX_PER_BOT)
            .project({ _id: 1 })
            .toArray()
        if (old.length) {
            await db.collection(COL).deleteMany({ _id: { $in: old.map(x => x._id) } })
        }
    } catch (e) {
        console.error('[cmd-error-log]', e.message)
    }
}

export async function listCommandErrors(botId, { limit = 20 } = {}) {
    const db = await getMongoDb()
    return db.collection(COL)
        .find({ botId: String(botId) })
        .sort({ createdAt: -1 })
        .limit(Math.min(50, limit))
        .toArray()
}

export async function listCommandErrorsAdmin({ page = 1, limit = 20, q = '', botId = '' } = {}) {
    const db = await getMongoDb()
    const pageNum = Math.max(1, Math.min(10000, Number(page) || 1))
    const lim = Math.max(1, Math.min(50, Number(limit) || 20))
    const skip = (pageNum - 1) * lim
    const filter = {}
    if (botId) filter.botId = String(botId).slice(0, 64)
    const query = String(q || '').trim().slice(0, 80)
    if (query) {
        const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        filter.$or = [
            { cmd: { $regex: safe, $options: 'i' } },
            { message: { $regex: safe, $options: 'i' } },
            { botId: { $regex: safe, $options: 'i' } }
        ]
    }
    const col = db.collection(COL)
    const [total, rows] = await Promise.all([
        col.countDocuments(filter),
        col.find(filter, { projection: { stack: 0 } })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(lim)
            .toArray()
    ])
    return {
        total,
        page: pageNum,
        limit: lim,
        pages: Math.max(1, Math.ceil(total / lim)),
        errors: rows.map(e => ({
            id: e._id?.toString(),
            botId: e.botId,
            sessionId: e.sessionId,
            cmd: e.cmd,
            message: e.message,
            createdAt: e.createdAt
        }))
    }
}

export async function ensureCommandErrorIndexes() {
    try {
        const db = await getMongoDb()
        await db.collection(COL).createIndex({ botId: 1, createdAt: -1 })
        await db.collection(COL).createIndex({ createdAt: -1 })
    } catch {}
}
