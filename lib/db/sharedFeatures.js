import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

const COL = 'shared_features'

export async function listSharedFeatures() {
    const db = await getMongoDb()
    return db.collection(COL).find({}).sort({ category: 1, title: 1 }).toArray()
}

export async function getSharedFeature(featureKey) {
    const db = await getMongoDb()
    return db.collection(COL).findOne({ featureKey })
}

export async function upsertSharedFeature({ featureKey, title, description, category, active = true }) {
    if (!featureKey || !String(featureKey).trim()) throw new Error('featureKey wajib')
    const key = String(featureKey).trim().toLowerCase()
    const db = await getMongoDb()
    const doc = {
        featureKey: key,
        title: (title || key).trim().slice(0, 80),
        description: (description || '').trim().slice(0, 300),
        category: (category || 'others').trim().toLowerCase().slice(0, 40),
        active: active !== false,
        updatedAt: new Date()
    }
    await db.collection(COL).updateOne(
        { featureKey: key },
        { $set: doc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
    )
    return db.collection(COL).findOne({ featureKey: key })
}

export async function removeSharedFeature(featureKey) {
    const db = await getMongoDb()
    const key = String(featureKey).trim().toLowerCase()
    await db.collection(COL).deleteOne({ featureKey: key })
    return true
}

export async function ensureSharedFeaturesIndex() {
    const db = await getMongoDb()
    try {
        await db.collection(COL).createIndex({ featureKey: 1 }, { unique: true })
        await db.collection(COL).createIndex({ active: 1, category: 1 })
    } catch {}
}
