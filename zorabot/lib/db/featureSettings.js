import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'
import { DEFAULT_ACCESS_RULES } from './defaultAccessRules.js'

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
        const defaultRules = DEFAULT_ACCESS_RULES[featureKey] || []
        return {
            botId, featureKey, enabled: true,
            customResponse: null, customCommand: null,
            accessRule: defaultRules.length ? defaultRules.join('+') : 'public',
            accessRules: defaultRules
        }
    }
    // Kalau belum pernah disimpan sama sekali lewat dashboard (accessRules & accessRule
    // dua-duanya gak ada di doc), tetap pakai default -- bukan berarti orang udah
    // sengaja pilih "public".
    const hasExplicitRules = doc.accessRules != null || doc.accessRule != null
    const accessRules = hasExplicitRules
        ? normalizeRules(doc.accessRules != null ? doc.accessRules : doc.accessRule)
        : (DEFAULT_ACCESS_RULES[featureKey] || [])
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
