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

    // Baca banyak key sekaligus (1 query $in) alih-alih satu findOne per key.
    // Baileys minta signal keys per pesan masuk (bisa banyak id sekaligus di grup
    // besar) -- N round-trip Mongo paralel tetap menambah latency nyata sebelum
    // command sempat mulai diproses. makeCacheableSignalKeyStore sudah nge-cache
    // di memori, jadi ini cuma kepakai saat cache miss (pertama kali / restart).
    async function readMany(ids) {
        if (!ids.length) return new Map()
        const docs = await col.find({ _id: { $in: ids.map(docId) } }).toArray()
        const map = new Map()
        for (const doc of docs) map.set(doc._id, deserialize(doc.value))
        return map
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
                    const keys = ids.map((id) => `${type}-${id}`)
                    const found = await readMany(keys)
                    for (const id of ids) {
                        let value = found.get(docId(`${type}-${id}`))
                        if (value === undefined) continue
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value)
                        }
                        if (value) data[id] = value
                    }
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
