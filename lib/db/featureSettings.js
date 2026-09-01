import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

export const ACCESS_RULES = ['owner', 'group', 'owner_group', 'public']

export async function getFeatureSetting(botId, featureKey) {
    const db = await getMongoDb()
    const doc = await db.collection(COLLECTIONS.FEATURE_SETTINGS).findOne({ botId, featureKey })
    return doc || { botId, featureKey, enabled: true, customResponse: null, customCommand: null, accessRule: 'public' }
}

export async function getAllFeatureSettings(botId) {
    const db = await getMongoDb()
    return db.collection(COLLECTIONS.FEATURE_SETTINGS).find({ botId }).toArray()
}

export async function setFeatureSetting(botId, featureKey, patch) {
    const db = await getMongoDb()
    if (patch.accessRule && !ACCESS_RULES.includes(patch.accessRule)) {
        throw new Error(`accessRule tidak valid: ${patch.accessRule}`)
    }
    await db.collection(COLLECTIONS.FEATURE_SETTINGS).updateOne(
        { botId, featureKey },
        { $set: { ...patch, updatedAt: new Date() } },
        { upsert: true }
    )
}
