import { MongoClient } from 'mongodb'

let client = null
let dbInstance = null
let connecting = null

export async function getMongoDb() {
    if (dbInstance) return dbInstance

    if (connecting) return connecting

    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error('MONGODB_URI belum diset di environment variable')

    connecting = (async () => {
        client = new MongoClient(uri, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 8000,
            connectTimeoutMS: 8000,
            socketTimeoutMS: 20000
        })
        await client.connect()
        dbInstance = client.db()
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
