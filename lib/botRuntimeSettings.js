/**
 * Per-bot runtime settings (isolated by sessionId).
 * Dashboard saves to bot_settings collection; this module applies them on the
 * live socket so Bot A never inherits Bot B settings.
 */
import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'

export const RUNTIME_DEFAULTS = {
    mode: 'public',
    noprefix: false,
    autoread: false,
    autotyping: false,
    fastrespon: false,
    errorReport: true,
    gconly: false,
    gconlyPremiumBypass: false,
    blockedCmds: [],
    extraOwners: [],
    // Custom messages (null = use config.text / hardcoded fallback)
    messages: {
        notRegistered: null,
        didYouMean: null,
        premiumRequired: null,
        permissionDenied: null,
        featureDisabled: null,
        commandBlocked: null,
        errorGeneric: null
    }
}

const cache = new Map() // sessionId -> { data, expires }
const TTL_MS = 60_000

export function mergeRuntimeSettings(doc) {
    const raw = doc && typeof doc === 'object' ? doc : {}
    const { _id, botId, updatedAt, ...rest } = raw
    const messages = {
        ...RUNTIME_DEFAULTS.messages,
        ...(rest.messages && typeof rest.messages === 'object' ? rest.messages : {})
    }
    return {
        ...RUNTIME_DEFAULTS,
        ...rest,
        messages,
        blockedCmds: Array.isArray(rest.blockedCmds) ? rest.blockedCmds : RUNTIME_DEFAULTS.blockedCmds,
        extraOwners: Array.isArray(rest.extraOwners) ? rest.extraOwners : RUNTIME_DEFAULTS.extraOwners
    }
}

export async function loadBotRuntimeSettings(sessionId) {
    if (!sessionId) return mergeRuntimeSettings(null)
    const hit = cache.get(sessionId)
    if (hit && hit.expires > Date.now()) return hit.data
    try {
        const db = await getMongoDb()
        const doc = await db.collection(COLLECTIONS.BOT_SETTINGS).findOne({ botId: sessionId })
        const data = mergeRuntimeSettings(doc)
        cache.set(sessionId, { data, expires: Date.now() + TTL_MS })
        return data
    } catch {
        return mergeRuntimeSettings(null)
    }
}

export function invalidateRuntimeSettings(sessionId) {
    if (sessionId) cache.delete(sessionId)
    else cache.clear()
}

/** Attach / refresh settings on a live socket (non-blocking safe). */
export async function applyRuntimeSettingsToSock(sock, sessionId) {
    if (!sock) return null
    const sid = sessionId || sock.sessionId
    const data = await loadBotRuntimeSettings(sid)
    sock.botSettings = data
    return data
}

/**
 * Prefer per-bot settings on sock; fall back to platform global `settings` export
 * for fields that still live in the single-tenant path.
 */
export function getRuntimeSettings(sock, platformSettings = {}) {
    const live = sock?.botSettings
    if (live && typeof live === 'object') {
        return { ...RUNTIME_DEFAULTS, ...platformSettings, ...live, messages: { ...RUNTIME_DEFAULTS.messages, ...(platformSettings.messages || {}), ...(live.messages || {}) } }
    }
    return { ...RUNTIME_DEFAULTS, ...platformSettings }
}

export function msgOr(runtime, key, fallback) {
    const v = runtime?.messages?.[key]
    if (v != null && String(v).trim()) return String(v)
    return fallback
}
