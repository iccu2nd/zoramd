import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

/** Flag yang boleh dicentang (multi). Kosong / public = semua boleh. */
export const ACCESS_FLAGS = ['owner', 'admin', 'group', 'private']

function normalizeRules(input) {
    if (input == null || input === '' || input === 'public') return []
    if (Array.isArray(input)) {
        return [...new Set(input.map(String).filter(r => ACCESS_FLAGS.includes(r)))]
    }
    // legacy single string
    const s = String(input)
    if (s === 'owner') return ['owner']
    if (s === 'group') return ['group']
    if (s === 'owner_group') return ['owner', 'group']
    if (s === 'admin') return ['admin']
    if (s === 'private') return ['private']
    return []
}

export async function getFeatureSetting(botId, featureKey) {
    const db = await getMongoDb()
    const doc = await db.collection(COLLECTIONS.FEATURE_SETTINGS).findOne({ botId, featureKey })
    if (!doc) {
        return {
            botId, featureKey, enabled: true,
            customResponse: null, customCommand: null,
            accessRule: 'public', accessRules: []
        }
    }
    const accessRules = normalizeRules(doc.accessRules != null ? doc.accessRules : doc.accessRule)
    return {
        ...doc,
        accessRules,
        // legacy field for old clients
        accessRule: accessRules.length ? accessRules.join('+') : 'public'
    }
}

export async function getAllFeatureSettings(botId) {
    const db = await getMongoDb()
    const list = await db.collection(COLLECTIONS.FEATURE_SETTINGS).find({ botId }).toArray()
    return list.map(doc => {
        const accessRules = normalizeRules(doc.accessRules != null ? doc.accessRules : doc.accessRule)
        return {
            ...doc,
            accessRules,
            accessRule: accessRules.length ? accessRules.join('+') : 'public'
        }
    })
}

export async function setFeatureSetting(botId, featureKey, patch) {
    const db = await getMongoDb()
    const set = { ...patch, updatedAt: new Date() }
    if (patch.accessRules != null || patch.accessRule != null) {
        const rules = normalizeRules(patch.accessRules != null ? patch.accessRules : patch.accessRule)
        set.accessRules = rules
        set.accessRule = rules.length ? rules.join('+') : 'public'
    }
    await db.collection(COLLECTIONS.FEATURE_SETTINGS).updateOne(
        { botId, featureKey },
        { $set: set },
        { upsert: true }
    )
}
