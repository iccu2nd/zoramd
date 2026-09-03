/**
 * Feature gate – if a feature is turned OFF in dashboard, its logic must not run.
 * Access rules & custom response are applied when premium settings exist.
 */
import { getFeatureSetting, getAllFeatureSettings } from './db/featureSettings.js'

const cache = new Map() // key: botId:featureKey -> { data, expires }
const TTL = 15_000

const cmdMapCache = new Map() // key: botId -> { data: Map(customCmdLower -> featureKey), expires }
const CMDMAP_TTL = 15_000

async function getCached(botId, featureKey) {
    const k = `${botId}:${featureKey}`
    const hit = cache.get(k)
    if (hit && hit.expires > Date.now()) return hit.data
    const data = await getFeatureSetting(botId, featureKey)
    cache.set(k, { data, expires: Date.now() + TTL })
    return data
}

export function invalidateFeatureCache(botId, featureKey) {
    if (featureKey) cache.delete(`${botId}:${featureKey}`)
    else {
        for (const k of cache.keys()) {
            if (k.startsWith(botId + ':')) cache.delete(k)
        }
    }
    cmdMapCache.delete(botId)
}

/**
 * Map "custom command" (yang diset di Feature Settings) -> featureKey asli,
 * supaya command hasil ganti nama beneran dikenali bot saat runtime.
 * Command default tetap jalan juga (custom command = alias tambahan, bukan pengganti).
 */
export async function getCustomCommandMap(botId) {
    if (!botId) return new Map()
    const hit = cmdMapCache.get(botId)
    if (hit && hit.expires > Date.now()) return hit.data
    const map = new Map()
    try {
        const all = await getAllFeatureSettings(botId)
        for (const s of all) {
            if (s.customCommand) {
                const c = String(s.customCommand).trim().toLowerCase()
                if (c) map.set(c, s.featureKey)
            }
        }
    } catch {}
    cmdMapCache.set(botId, { data: map, expires: Date.now() + CMDMAP_TTL })
    return map
}

/**
 * Returns { enabled, accessRule, customResponse, customCommand }
 * Default: enabled true, public.
 */
export async function resolveFeature(botId, featureKey) {
    if (!botId || !featureKey) {
        return { enabled: true, accessRule: 'public', accessRules: [], customResponse: null, customCommand: null }
    }
    try {
        return await getCached(botId, featureKey)
    } catch {
        return { enabled: true, accessRule: 'public', accessRules: [], customResponse: null, customCommand: null }
    }
}

/**
 * Access flags (multi-checkbox, OR logic):
 * owner | admin | group | private
 * Kosong / public = semua boleh.
 * Centang 2+ = user lolos jika cocok salah satu.
 */
export function checkAccessRule(rule, m) {
    let rules = []
    if (Array.isArray(rule)) rules = rule
    else if (rule && typeof rule === 'object' && Array.isArray(rule.accessRules)) rules = rule.accessRules
    else if (typeof rule === 'string') {
        if (!rule || rule === 'public') rules = []
        else if (rule === 'owner_group') rules = ['owner', 'group']
        else if (rule.includes('+')) rules = rule.split('+')
        else rules = [rule]
    }
    rules = rules.filter(Boolean)
    if (!rules.length) return true

    return rules.some(r => {
        if (r === 'owner') return !!m.isOwner
        if (r === 'admin') return !!m.isAdmin
        if (r === 'group') return !!m.isGroup
        if (r === 'private') return !m.isGroup
        if (r === 'public') return true
        return false
    })
}
