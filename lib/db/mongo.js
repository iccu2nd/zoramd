import { MongoClient } from 'mongodb'

let client = null
let dbInstance = null

export async function getMongoDb() {
    if (dbInstance) return dbInstance

    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error('MONGODB_URI belum diset di environment variable')

    client = new MongoClient(uri, { maxPoolSize: 10 })
    await client.connect()
    dbInstance = client.db()
    return dbInstance
}

export async function closeMongo() {
    if (client) {
        await client.close()
        client = null
        dbInstance = null
    }
}
