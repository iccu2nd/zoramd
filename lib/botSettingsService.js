/**
 * Centralized Bot Settings Service
 * Dashboard → API → Mongo (bot_settings) → this cache → Bot Engine / Handler / Plugins
 *
 * Isolasi per botId. Perubahan settings langsung berlaku tanpa restart
 * (invalidate + push ke sock instance yang hidup).
 */
import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'

const CACHE_TTL_MS = Number(process.env.BOT_SETTINGS_CACHE_TTL_MS || 60_000)
const cache = new Map() // botId -> { data, expires }
const inflight = new Map()

/** Default schema — semua field Bot Control Center */
export const DEFAULT_BOT_SETTINGS = {
    // ---- General ----
    enabled: true,
    mode: 'public',                 // public | self
    prefixes: ['.', '/', '#', '!'], // array
    noprefix: false,
    language: 'id',
    timezone: 'Asia/Jakarta',
    footer: '© ZoraBot',
    autoread: false,
    autotyping: false,
    autorecording: false,
    responseDelayMs: 0,             // artificial delay (0 = off)
    maintenance: false,
    maintenanceMessage: 'Bot sedang maintenance. Coba lagi nanti.',
    errorReport: true,              // report technical error ke owner
    showTechnicalError: false,      // OFF default — jangan bocor stack/token ke user
    fastrespon: false,
    gconly: false,                  // false | 'join' | 'closed'
    gconlyPremiumBypass: false,
    extraOwners: [],
    blockedCmds: [],
    scheduledLeaves: {},
    sapaList: {},

    // ---- Verification ----
    verificationEnabled: true,
    verificationMessage: '*Kamu belum terverifikasi!*\n\nKetik *${prefix}verify* untuk verifikasi nama WhatsApp kamu.',
    verificationBypassOwner: true,
    verificationBypassAdmin: false,
    verificationBypassPremium: false,

    // ---- Limit system ----
    limitEnabled: false,
    limitGlobal: 25,
    limitFree: 15,
    limitPremium: 100,
    limitAdmin: 200,
    limitOwner: -1,                 // -1 = unlimited
    limitResetCron: '0 0 * * *',    // daily midnight (informational; actual reset via API/cron)
    limitResetHour: 0,              // 0-23 WIB
    limitMessage: 'Limit harian kamu sudah habis.\nLimit tersisa: *0*\n\nUpgrade Premium atau tunggu reset harian.',
    // per-command limits stored in feature_settings.limitCost

    // ---- Custom Messages (template dengan variabel) ----
    messages: {
        error: 'Maaf fitur sedang error.',
        loading: '⏳ Sedang diproses...',
        success: '✅ Berhasil.',
        failed: '❌ Gagal.',
        premiumRequired: 'Fitur ini khusus Premium.',
        verificationRequired: '*Kamu belum terverifikasi!*\n\nKetik *${prefix}verify* untuk verifikasi.',
        limitHabis: 'Limit harian kamu sudah habis.\nLimit tersisa: *0*',
        ownerOnly: 'Khusus Owner.',
        adminOnly: 'Khusus Admin grup.',
        banned: 'Akun kamu dibanned dari bot ini.',
        maintenance: 'Bot sedang maintenance. Coba lagi nanti.',
        unknownCommand: 'Perintah *${prefix}${command}* tidak ditemukan.',
        welcome: 'Hai @pushname, selamat datang di @gcname!',
        goodbye: 'Selamat tinggal @pushname.',
        ownerMessage: '',
        adminMessage: '',
        premiumMessage: '',
        userMessage: ''
    }
}

function deepMerge(base, patch) {
    if (!patch || typeof patch !== 'object') return { ...base }
    const out = { ...base }
    for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
            out[k] = deepMerge(base[k], v)
        } else if (v !== undefined) {
            out[k] = v
        }
    }
    return out
}

function normalize(raw = {}) {
    const merged = deepMerge(DEFAULT_BOT_SETTINGS, raw)
    // normalize arrays
    if (typeof merged.prefixes === 'string') {
        merged.prefixes = merged.prefixes.split(/[\s,]+/).filter(Boolean)
    }
    if (!Array.isArray(merged.prefixes) || !merged.prefixes.length) {
        merged.prefixes = ['.', '/', '#', '!']
    }
    if (!Array.isArray(merged.extraOwners)) merged.extraOwners = []
    if (!Array.isArray(merged.blockedCmds)) merged.blockedCmds = []
    if (!merged.messages || typeof merged.messages !== 'object') {
        merged.messages = { ...DEFAULT_BOT_SETTINGS.messages }
    } else {
        merged.messages = { ...DEFAULT_BOT_SETTINGS.messages, ...merged.messages }
    }
    // coerce numbers
    for (const k of ['responseDelayMs', 'limitGlobal', 'limitFree', 'limitPremium', 'limitAdmin', 'limitOwner', 'limitResetHour']) {
        if (merged[k] != null) merged[k] = Number(merged[k])
    }
    return merged
}

/**
 * Render message template with variables.
 * Supports: ${e} ${error} ${command} ${user} ${username} ${number} ${botName} ${prefix} ${time}
 */
export function renderMessage(template, vars = {}) {
    if (!template) return ''
    const map = {
        e: vars.e ?? vars.error ?? '',
        error: vars.error ?? vars.e ?? '',
        command: vars.command ?? '',
        user: vars.user ?? vars.username ?? '',
        username: vars.username ?? vars.user ?? '',
        number: vars.number ?? '',
        botName: vars.botName ?? 'Bot',
        prefix: vars.prefix ?? '.',
        time: vars.time ?? new Date().toLocaleString('id-ID', { timeZone: vars.timezone || 'Asia/Jakarta' })
    }
    return String(template).replace(/\$\{(\w+)\}/g, (_, key) => {
        return map[key] != null ? String(map[key]) : ''
    })
}

export function invalidateBotSettingsCache(botId) {
    if (!botId) {
        cache.clear()
        inflight.clear()
        return
    }
    cache.delete(String(botId))
    inflight.delete(String(botId))
}

export async function getBotSettings(botId) {
    const key = String(botId || 'default')
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) return hit.data

    let pending = inflight.get(key)
    if (!pending) {
        pending = (async () => {
            try {
                const db = await getMongoDb()
                const doc = await db.collection(COLLECTIONS.BOT_SETTINGS).findOne({ botId: key })
                const data = normalize(doc || {})
                // strip mongo fields
                delete data._id
                delete data.botId
                delete data.updatedAt
                cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS })
                return data
            } finally {
                inflight.delete(key)
            }
        })()
        inflight.set(key, pending)
    }
    return pending
}

export async function saveBotSettings(botId, patch) {
    const key = String(botId)
    const current = await getBotSettings(key)
    const next = normalize({ ...current, ...patch, messages: { ...current.messages, ...(patch.messages || {}) } })
    const db = await getMongoDb()
    const toStore = { ...next, botId: key, updatedAt: new Date() }
    await db.collection(COLLECTIONS.BOT_SETTINGS).updateOne(
        { botId: key },
        { $set: toStore },
        { upsert: true }
    )
    cache.set(key, { data: next, expires: Date.now() + CACHE_TTL_MS })
    return next
}

/**
 * Push live settings ke sock instance (tanpa restart).
 */
export function applySettingsToSock(sock, settings) {
    if (!sock) return
    sock._botSettings = settings
    // sync commonly used flags onto legacy global-style for gradual migration
    if (sock.botConfig) {
        sock.botConfig.footer = settings.footer
        sock.botConfig.language = settings.language
        sock.botConfig.timezone = settings.timezone
    }
}

/**
 * Resolve settings for a message path: prefer live sock cache, else service.
 */
export async function resolveRuntimeSettings(sock, botId) {
    if (sock?._botSettings) return sock._botSettings
    const id = botId || sock?.sessionId || sock?.botConfig?.botId || 'default'
    const s = await getBotSettings(id)
    if (sock) sock._botSettings = s
    return s
}

/**
 * Limit helpers — stored on user object in global.db.data.users[jid]
 */
export function getUserLimitQuota(settings, role) {
    if (!settings.limitEnabled) return -1
    switch (role) {
        case 'owner': return settings.limitOwner ?? -1
        case 'admin': return settings.limitAdmin ?? 200
        case 'premium': return settings.limitPremium ?? 100
        default: return settings.limitFree ?? settings.limitGlobal ?? 15
    }
}

export function ensureUserLimit(user, settings, role) {
    if (!user) return { remaining: -1, quota: -1 }
    const quota = getUserLimitQuota(settings, role)
    if (quota < 0) return { remaining: -1, quota: -1 }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: settings.timezone || 'Asia/Jakarta' })
    if (user.limitDate !== today) {
        user.limitDate = today
        user.limitUsed = 0
        user.limit = quota
    }
    if (typeof user.limit !== 'number') user.limit = quota
    if (typeof user.limitUsed !== 'number') user.limitUsed = 0
    const remaining = Math.max(0, (user.limit ?? quota) - (user.limitUsed || 0))
    return { remaining, quota }
}

export function consumeUserLimit(user, cost = 1) {
    if (!user) return
    user.limitUsed = (user.limitUsed || 0) + cost
    if (typeof user.limit === 'number' && user.limit >= 0) {
        user.limit = Math.max(0, user.limit - cost)
    }
}

/** Cooldown store (in-memory per process) */
const cooldowns = new Map() // key: botId:jid:cmd -> expiresAt

export function checkCooldown(botId, jid, cmd, seconds) {
    if (!seconds || seconds <= 0) return { ok: true, retryAfter: 0 }
    const key = `${botId}:${jid}:${cmd}`
    const exp = cooldowns.get(key) || 0
    const now = Date.now()
    if (exp > now) return { ok: false, retryAfter: Math.ceil((exp - now) / 1000) }
    cooldowns.set(key, now + seconds * 1000)
    if (cooldowns.size > 20000) {
        for (const [k, v] of cooldowns) {
            if (v < now) cooldowns.delete(k)
        }
    }
    return { ok: true, retryAfter: 0 }
}

export { normalize as normalizeBotSettings, DEFAULT_BOT_SETTINGS as defaults }
