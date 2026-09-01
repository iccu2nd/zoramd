import { proto } from '@whiskeysockets/baileys'
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'
import { getMongoDb } from './db/mongo.js'

const COLLECTION = 'wa_auth'

function serialize(value) {
    return JSON.parse(JSON.stringify(value, BufferJSON.replacer))
}

function deserialize(value) {
    return JSON.parse(JSON.stringify(value), BufferJSON.reviver)
}

// Auth state Baileys (creds + signal keys) disimpan per-sessionId di MongoDB,
// jadi bot otomatis reconnect pakai session yang sama setelah server restart
// tanpa perlu pairing ulang, dan tiap user/bot (sessionId beda) datanya terisolasi.
export async function useMongoAuthState(sessionId) {
    const db = await getMongoDb()
    const col = db.collection(COLLECTION)

    const docId = (id) => `${sessionId}:${id}`

    async function readData(id) {
        const doc = await col.findOne({ _id: docId(id) })
        return doc ? deserialize(doc.value) : null
    }

    async function writeData(id, value) {
        await col.updateOne(
            { _id: docId(id) },
            { $set: { value: serialize(value) } },
            { upsert: true }
        )
    }

    async function removeData(id) {
        await col.deleteOne({ _id: docId(id) })
    }

    const creds = (await readData('creds')) || initAuthCreds()

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {}
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`)
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value)
                        }
                        if (value) data[id] = value
                    }))
                    return data
                },
                set: async (data) => {
                    const tasks = []
                    for (const type in data) {
                        for (const id in data[type]) {
                            const value = data[type][id]
                            const key = `${type}-${id}`
                            tasks.push(value ? writeData(key, value) : removeData(key))
                        }
                    }
                    await Promise.all(tasks)
                }
            }
        },
        saveCreds: () => writeData('creds', creds),
        // Dipakai saat user logout / ganti nomor supaya session lama tidak nyangkut di Mongo
        clearSession: async () => {
            await col.deleteMany({ _id: { $regex: `^${sessionId}:` } })
        }
    }
}
