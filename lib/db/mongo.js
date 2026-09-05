import { MongoClient } from 'mongodb'

let client = null
let dbInstance = null
let connecting = null
let lastPingAt = 0
const PING_INTERVAL_MS = 60_000

export async function getMongoDb() {
    if (dbInstance) {
        // Keep connection warm so first command after idle does not pay
        // Atlas/serverless cold-start latency on the critical path.
        const now = Date.now()
        if (now - lastPingAt > PING_INTERVAL_MS) {
            lastPingAt = now
            dbInstance.command({ ping: 1 }).catch(() => {
                // Force reconnect on next call if ping fails
                client = null
                dbInstance = null
            })
        }
        return dbInstance
    }

    if (connecting) return connecting

    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error('MONGODB_URI belum diset di environment variable')

    connecting = (async () => {
        client = new MongoClient(uri, {
            // Keep a small warm pool so idle periods do not drop every socket.
            maxPoolSize: Number(process.env.MONGO_MAX_POOL || 15),
            minPoolSize: Number(process.env.MONGO_MIN_POOL || 2),
            maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_MS || 300_000),
            serverSelectionTimeoutMS: 8000,
            connectTimeoutMS: 8000,
            socketTimeoutMS: 45000,
            // Heartbeat keeps topology discovery alive across long idle gaps.
            heartbeatFrequencyMS: 20_000
        })
        await client.connect()
        dbInstance = client.db()
        lastPingAt = Date.now()
        // Background keep-alive so first query after long idle is not the reconnection.
        try {
            const keepAlive = setInterval(() => {
                if (!dbInstance) return
                dbInstance.command({ ping: 1 }).catch(() => {
                    client = null
                    dbInstance = null
                })
            }, PING_INTERVAL_MS)
            keepAlive.unref?.()
        } catch {}
        connecting = null
        return dbInstance
    })()

    try {
        return await connecting
    } catch (e) {
        connecting = null
        client = null
        dbInstance = null
        throw e
    }
}

export async function closeMongo() {
    if (client) {
        await client.close().catch(() => {})
        client = null
        dbInstance = null
    }
}
