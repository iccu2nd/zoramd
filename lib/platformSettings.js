import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'

const KEY = 'global'

const defaults = {
    freeAdsEnabled: true,
    adsText: 'Bot ini menggunakan layanan dari botzora.my.id\nhttps://botzora.my.id',
    adsPerDay: 3
}

export async function getPlatformSettings() {
    const db = await getMongoDb()
    const doc = await db.collection(COLLECTIONS.PLATFORM_SETTINGS).findOne({ key: KEY })
    return { ...defaults, ...(doc || {}) }
}

export async function setPlatformSettings(patch) {
    const db = await getMongoDb()
    const clean = {}
    if (typeof patch.freeAdsEnabled === 'boolean') clean.freeAdsEnabled = patch.freeAdsEnabled
    if (typeof patch.adsText === 'string' && patch.adsText.trim()) {
        clean.adsText = patch.adsText.trim().slice(0, 4000)
    }
    if (patch.adsPerDay != null) clean.adsPerDay = Math.min(10, Math.max(1, Number(patch.adsPerDay) || 3))
    await db.collection(COLLECTIONS.PLATFORM_SETTINGS).updateOne(
        { key: KEY },
        { $set: { ...clean, key: KEY, updatedAt: new Date() } },
        { upsert: true }
    )
    return getPlatformSettings()
}
