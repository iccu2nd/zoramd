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

export async function ensureCommandErrorIndexes() {
    try {
        const db = await getMongoDb()
        await db.collection(COL).createIndex({ botId: 1, createdAt: -1 })
    } catch {}
}
