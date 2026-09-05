import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import {
    authMiddleware, loadAccount, register, login, startRegister, completeRegister, isAdminAccount,
    requestEmailVerification, confirmEmailVerification,
    requestPasswordReset, resetPassword
} from '../auth.js'
import {
    createBot, findBotsByOwner, findOwnedBot, updateOwnedBot, findBotBySessionId, setBotStatus,
    listAllAccounts, listAllBots, listAccountsPaged, listBotsPaged, setAccountRole, deleteBotById, deleteAccountById, updateAccount, findAccountById
} from '../../lib/db/accounts.js'
import { getSubscription, isBotPremium, activatePremium, isAccountPremium, activateAccountPremium, getAccountSubscription } from '../../lib/db/subscription.js'
import { getAllFeatureSettings, setFeatureSetting, getFeatureSetting, ACCESS_FLAGS } from '../../lib/db/featureSettings.js'
import { invalidateFeatureCache } from '../../lib/featureGate.js'
import { DEFAULT_ACCESS_RULES } from '../../lib/db/defaultAccessRules.js'
import { createOrder, findOrder, findOrdersByAccount, markOrderChecked, cancelOrder, deleteOrder, isOrderExpired } from '../../lib/db/orders.js'
import { getMongoDb } from '../../lib/db/mongo.js'
import { COLLECTIONS } from '../../lib/db/schema.js'
import botManager from '../../lib/botManager.js'
import { getPlatformSettings, setPlatformSettings } from '../../lib/platformSettings.js'
import { sendAdsManually } from '../../lib/adsScheduler.js'
import * as sociabuzz from '../../lib/sociabuzz.js'
import { rateLimit, clientIp } from '../../lib/rateLimit.js'
import { getSessionMetrics, getAggregateMetrics, clearSessionMetrics } from '../../lib/botMetrics.js'
import { AUTH_COOKIE_NAME, authCookieOptions, clearAuthCookies, publicError } from '../../lib/security.js'
import { getChatLog } from '../../lib/liveChatlog.js'
import { pushNotification, listNotifications, markNotificationsRead, countUnread } from '../../lib/notifications.js'
import { listCommandErrors, listCommandErrorsAdmin } from '../../lib/commandErrors.js'

const router = Router()

// Auth endpoints: ketat (anti brute-force)
const authStrictLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    blockMs: 15 * 60 * 1000,
    keyFn: (req) => 'auth:' + clientIp(req),
    message: 'Terlalu banyak percobaan login/register. Coba lagi dalam 15 menit.'
})
const otpLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    blockMs: 30 * 60 * 1000,
    keyFn: (req) => 'otp:' + clientIp(req),
    message: 'Too many OTP requests. Please try again later.'
})
const adsSendLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    keyFn: (req) => 'ads:' + (req.user?.sub || clientIp(req)),
    message: 'Too many ad sends. Please wait a few minutes.'
})
const createBotLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyFn: (req) => 'createbot:' + (req.user?.sub || clientIp(req)),
    message: 'Too many bots created. Please wait and try again.'
})

// Health (no secrets)
router.get('/health', (req, res) => {
    res.json({ ok: true, service: 'zorabot', time: new Date().toISOString() })
})


const PREMIUM_PRICE = 15000
const PREMIUM_PLANS = { '7d': { days: 7, price: 5000, label: '7 Hari' }, '30d': { months: 1, price: 15000, label: '30 Hari' } }
function resolvePlan(duration) { return PREMIUM_PLANS[duration] || PREMIUM_PLANS['30d'] }

function statusLabel(s) {
    const map = {
        connected: 'Connected',
        connecting: 'Connecting...',
        pairing: 'Waiting for pairing',
        qr: 'Waiting for QR scan',
        disconnected: 'Disconnected',
        logged_out: 'Logged out of WhatsApp'
    }
    return map[s] || s || 'Disconnected'
}

/** Normalize & validate international WhatsApp number (e.g. 628xxx). Returns digits-only or null. */
function normalizePhone(raw) {
    if (raw == null || raw === '') return null
    let s = String(raw).trim()
    // allow +62..., spaces, dashes from paste
    s = s.replace(/[\s\-()]/g, '')
    if (s.startsWith('+')) s = s.slice(1)
    // convert leading 0 to 62 (ID local format)
    if (s.startsWith('0')) s = '62' + s.slice(1)
    if (!/^\d{10,15}$/.test(s)) return null
    return s
}



function requireAdmin(req, res, next) {
    // Hide admin surface from non-admins (404, not 403)
    if (!req.account || !isAdminAccount(req.account)) {
        return res.status(404).json({ error: 'Not found' })
    }
    next()
}

function safeObjectId(id) {
    try {
        if (!id || !ObjectId.isValid(id)) return null
        return new ObjectId(id)
    } catch {
        return null
    }
}

function validateImportValue(value, state = { nodes: 0 }, depth = 0) {
    if (value == null || typeof value !== 'object') return true
    if (depth > 12) return false
    if (Array.isArray(value)) {
        if (value.length > 10000) return false
        return value.every(item => validateImportValue(item, state, depth + 1))
    }
    const keys = Object.keys(value)
    state.nodes += keys.length
    if (state.nodes > 50000) return false
    for (const key of keys) {
        if (key.startsWith('$') || key.includes('.')) return false
        if (!validateImportValue(value[key], state, depth + 1)) return false
    }
    return true
}

function importMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// ---------- Auth ----------
router.post('/auth/register', authStrictLimit, async (req, res) => {
    try {
        const { email, password, name } = req.body || {}
        const result = await startRegister({ email, password, name })
        res.json({ pending: true, email: result.email, message: 'Kode OTP dikirim ke email' })
    } catch (e) {
        res.status(400).json({ error: publicError(e, 'Registration failed') })
    }
})

router.post('/auth/register/confirm', authStrictLimit, async (req, res) => {
    try {
        const { email, code } = req.body || {}
        const { account, token } = await completeRegister({ email, code })
        res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions(req))
        res.json({
            token,
            user: {
                id: account._id,
                email: account.email,
                name: account.name,
                emailVerified: true
            }
        })
    } catch (e) {
        res.status(400).json({ error: publicError(e, 'Verification failed') })
    }
})

router.post('/auth/register/resend', authStrictLimit, async (req, res) => {
    try {
        const { email, password, name } = req.body || {}
        // resend = start ulang (butuh password lagi dari form pending di client)
        const result = await startRegister({ email, password, name })
        res.json({ pending: true, email: result.email, message: 'Kode OTP dikirim ulang' })
    } catch (e) {
        res.status(400).json({ error: publicError(e, 'Failed to resend OTP') })
    }
})

router.post('/auth/login', authStrictLimit, async (req, res) => {
    try {
        const { email, password } = req.body || {}
        const { account, token } = await login({ email, password })
        res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions(req))
        res.json({
            token,
            user: { id: account._id, email: account.email, name: account.name }
        })
    } catch (e) {
        res.status(400).json({ error: publicError(e, 'Login failed') })
    }
})

router.post('/auth/logout', (req, res) => {
    clearAuthCookies(req, res)
    res.json({ ok: true })
})

router.get('/auth/me', authMiddleware, loadAccount, (req, res) => {
    res.json({
        user: {
            id: req.account._id,
            email: req.account.email,
            name: req.account.name,
            role: req.account.role || 'user',
            isAdmin: isAdminAccount(req.account),
            emailVerified: !!req.account.emailVerified
        }
    })
})

// ---------- Verifikasi email (OTP) ----------
router.post('/auth/verify-email/request', authMiddleware, loadAccount, otpLimit, async (req, res) => {
    try {
        if (req.account.emailVerified) return res.json({ ok: true, alreadyVerified: true })
        await requestEmailVerification(req.account.email)
        res.json({ ok: true })
    } catch (e) {
        res.status(400).json({ error: publicError(e, 'Failed to send OTP') })
    }
})

router.post('/auth/verify-email/confirm', authMiddleware, loadAccount, otpLimit, async (req, res) => {
    try {
        const { code } = req.body || {}
        await confirmEmailVerification(req.account.email, code)
        res.json({ ok: true })
    } catch (e) {
        res.status(400).json({ error: publicError(e, 'Verification failed') })
    }
})

// ---------- Reset password (OTP, tanpa login) ----------
router.post('/auth/password/forgot', otpLimit, async (req, res) => {
    try {
        await requestPasswordReset((req.body || {}).email)
    } catch (e) {
        console.error('[auth] forgot-password:', e.message)
    }
    // Selalu balas generik -- jangan bocorin apakah email itu terdaftar.
    res.json({ ok: true, note: 'Kalau email terdaftar, kode reset sudah dikirim.' })
})

router.post('/auth/password/reset', otpLimit, async (req, res) => {
    try {
        const { email, code, newPassword } = req.body || {}
        await resetPassword({ email, code, newPassword })
        res.json({ ok: true })
    } catch (e) {
        res.status(400).json({ error: publicError(e, 'Reset password gagal') })
    }
})

// ---------- Bots ----------
router.get('/bots', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bots = await findBotsByOwner(req.account._id)
        const enriched = await Promise.all(bots.map(async (b) => {
            const sub = await getSubscription(b._id.toString())
            const state = botManager.getState(b.sessionId)
            const status = state.status || b.status || 'disconnected'
            return {
                id: b._id.toString(),
                sessionId: b.sessionId,
                botName: b.botName,
                ownerNumber: b.ownerNumber,
                identity: b.identity,
                status,
                statusLabel: statusLabel(status),
                lastError: state.lastError || null,
                enabled: b.enabled !== false,
                waName: state.waName || null,
                waNumber: state.waNumber || null,
                profilePic: state.profilePic || null,
                plan: sub.plan,
                premiumExpiresAt: sub.expiresAt,
                createdAt: b.createdAt
            }
        }))
        const anyPremium = await isAccountPremium(req.account._id.toString())
        for (const b of enriched) {
            b.plan = anyPremium ? 'premium' : 'free'
        }
        const maxBots = anyPremium ? 3 : 1
        res.json({
            bots: enriched,
            limits: { max: maxBots, used: enriched.length, plan: anyPremium ? 'premium' : 'free' }
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/bots', authMiddleware, loadAccount, createBotLimit, async (req, res) => {
    try {
        const { botName, ownerNumber } = req.body || {}
        const existing = await findBotsByOwner(req.account._id)

        const anyPremium = await isAccountPremium(req.account._id.toString())
        const maxBots = anyPremium ? 3 : 1
        if (existing.length >= maxBots) {
            return res.status(403).json({
                error: anyPremium
                    ? 'Premium limit: maximum 3 bots. Delete another bot first.'
                    : 'Free limit: maximum 1 bot. Upgrade to Premium for up to 3 bots.'
            })
        }

        const sessionId = 'bot_' + uuidv4().replace(/-/g, '').slice(0, 16)
        const bot = await createBot({
            ownerId: req.account._id,
            sessionId,
            botName: botName || 'ZoraBot',
            ownerNumber: ownerNumber || null
        })
        await getSubscription(bot._id.toString())
        res.json({
            bot: {
                id: bot._id.toString(),
                sessionId: bot.sessionId,
                botName: bot.botName,
                status: 'disconnected'
            },
            limits: { max: maxBots, used: existing.length + 1, plan: anyPremium ? 'premium' : 'free' }
        })
    } catch (e) {
        res.status(400).json({ error: publicError(e, 'Invalid request') })
    }
})

router.get('/bots/:botId', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const sub = await getSubscription(bot._id.toString())
        const state = botManager.getState(bot.sessionId)
        res.json({
            bot: {
                id: bot._id.toString(),
                sessionId: bot.sessionId,
                botName: bot.botName,
                ownerNumber: bot.ownerNumber,
                identity: bot.identity,
                status: state.status || bot.status,
                qr: state.qr,
                pairingCode: state.pairingCode,
                lastError: state.lastError,
                plan: sub.plan,
                premiumExpiresAt: sub.expiresAt
            }
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// Connect bot (start session)
router.post('/bots/:botId/connect', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const { phoneNumber, method } = req.body || {}
        // method: 'qr' | 'pairing'
        const forcePairing = method === 'pairing'
        let phone = null
        if (forcePairing) {
            phone = normalizePhone(phoneNumber)
            if (!phone) {
                return res.status(400).json({ error: 'Nomor WhatsApp tidak valid. Gunakan format internasional, contoh: 628xxxxxxxxxx' })
            }
        }
        const inst = await botManager.ensure(bot.sessionId, bot)
        // JANGAN await sampai selesai -- requestPairingCode ke WhatsApp bisa lama
        // (bahkan macet). Kalau di-await di sini, request HTTP ini ikut nunggu lama
        // dan dashboard keliatan "loading" terus. Lempar ke background, biarkan
        // frontend polling /status (sudah jalan tiap 5 detik) yang ambil kode begitu siap.
        inst.start({
            phoneNumber: forcePairing ? phone : undefined,
            forcePairing,
            // pairing selalu session bersih agar tidak Stream Errored dari session setengah
            clearSessionFirst: forcePairing || method === 'qr'
        }).catch(e => console.error(`[connect] start ${bot.sessionId}:`, e.message))
        res.json({ state: { ...inst.getPublicState(), status: forcePairing ? 'pairing' : 'connecting' } })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/bots/:botId/disconnect', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const { clearSession } = req.body || {}
        await botManager.stopBot(bot.sessionId, { clearSession: !!clearSession })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.delete('/bots/:botId', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        await botManager.stopBot(bot.sessionId, { clearSession: true })
        try { if (bot.sessionId) clearSessionMetrics(bot.sessionId) } catch {}
        await deleteBotById(req.params.botId)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})


router.patch('/bots/:botId', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const name = String(req.body?.botName || '').trim().slice(0, 64)
        if (!name) return res.status(400).json({ error: 'Bot name is required' })
        const ok = await updateOwnedBot(bot._id.toString(), req.account._id.toString(), { botName: name })
        if (!ok) return res.status(404).json({ error: 'Bot not found' })
        // Keep runtime config in sync when bot is live
        try {
            const state = botManager.getState(bot.sessionId)
            if (state?.sock) {
                state.sock.botConfig = { ...(state.sock.botConfig || {}), botName: name }
            }
        } catch {}
        res.json({ ok: true, botName: name })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to rename bot') })
    }
})

router.get('/bots/:botId/status', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const state = botManager.getState(bot.sessionId)
        res.json({ state })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// ---------- Bot Settings (premium gated for identity) ----------
router.get('/bots/:botId/settings', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const premium = (await isAccountPremium(req.account._id.toString())) || (await isBotPremium(bot._id.toString()))
        const db = await getMongoDb()
        const settingsDoc = await db.collection(COLLECTIONS.BOT_SETTINGS).findOne({ botId: bot.sessionId })
        res.json({
            settings: settingsDoc || {},
            identity: bot.identity || {},
            botName: bot.botName,
            ownerNumber: bot.ownerNumber,
            isPremium: premium
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.put('/bots/:botId/settings', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const premium = ((await isAccountPremium(req.account._id.toString())) || (await isBotPremium(bot._id.toString())))
        const body = req.body || {}

        // Free users: limited settings only
        const allowedFree = ['mode', 'autoread', 'autotyping', 'noprefix', 'gconly', 'fastrespon', 'enabled']
        const patchSettings = {}
        for (const k of allowedFree) {
            if (body[k] !== undefined) patchSettings[k] = body[k]
        }

        if (premium) {
            // Premium: full bot settings + identity
            const extra = ['errorReport', 'gconly', 'gconlyPremiumBypass']
            for (const k of extra) {
                if (body[k] !== undefined) patchSettings[k] = body[k]
            }
            if (body.identity || body.botName || body.ownerNumber) {
                const identity = { ...(bot.identity || {}), ...(body.identity || {}) }
                if (body.botName) identity.botName = body.botName
                if (body.ownerNumber) identity.ownerNumber = body.ownerNumber
                if (body.identity?.channelUrl) identity.channelUrl = body.identity.channelUrl
                if (body.identity?.groupUrl) identity.groupUrl = body.identity.groupUrl
                if (body.identity?.idch) identity.idch = body.identity.idch
                if (body.identity?.groupId) identity.groupId = body.identity.groupId
                if (body.identity?.author) identity.author = body.identity.author
                if (body.identity?.packname) identity.packname = body.identity.packname
                if (body.identity?.title) identity.title = body.identity.title
                if (body.identity?.body) identity.body = body.identity.body
                if (body.identity?.thumbnail) identity.thumbnail = body.identity.thumbnail
                await updateOwnedBot(bot._id.toString(), req.account._id.toString(), {
                    botName: identity.botName || bot.botName,
                    ownerNumber: identity.ownerNumber || bot.ownerNumber,
                    identity
                })
            }
        } else if (body.identity || body.botName || body.ownerNumber) {
            return res.status(403).json({ error: 'Custom identity is available for Premium only' })
        }

        if (Object.keys(patchSettings).length) {
            const db = await getMongoDb()
            await db.collection(COLLECTIONS.BOT_SETTINGS).updateOne(
                { botId: bot.sessionId },
                { $set: { ...patchSettings, updatedAt: new Date() } },
                { upsert: true }
            )
        }

        // Refresh identity/config di instance yang sedang running agar sticker & plugin
        // langsung ikut Bot Settings tanpa wajib restart manual.
        try {
            const fresh = await findOwnedBot(req.params.botId, req.account._id)
            if (fresh) {
                const inst = botManager.get(fresh.sessionId)
                if (inst) {
                    inst.botDoc = fresh
                    if (inst.sock) {
                        const cfg = inst.buildConfig()
                        cfg.ownerAccountId = fresh.ownerId?.toString?.() || fresh.ownerId || null
                        inst.sock.botConfig = cfg
                        inst.sock.sessionId = fresh.sessionId
                    }
                }
            }
        } catch (e) {
            console.error('[settings] refresh botConfig:', e.message)
        }

        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// ---------- Feature Settings ----------
router.get('/bots/:botId/features', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const premium = ((await isAccountPremium(req.account._id.toString())) || (await isBotPremium(bot._id.toString())))
        const saved = await getAllFeatureSettings(bot.sessionId)
        const savedMap = {}
        for (const s of saved) savedMap[s.featureKey] = s

        // Katalog penuh dari plugins yang ter-load, dikelompokkan per category
        const { plugins } = await import('../../lib/plugins.js')
        const groups = {}
        for (const [, plugin] of plugins) {
            const cmds = plugin.cmd || []
            if (!cmds.length) continue
            const key = cmds[0]
            const cat = (plugin.category || 'others').toLowerCase()
            if (!groups[cat]) groups[cat] = []
            // hindari duplikat key dalam group
            if (groups[cat].some(f => f.featureKey === key)) continue
            // savedMap[key] datang dari getAllFeatureSettings, yang sudah nge-resolve
            // accessRules dengan fallback ke DEFAULT_ACCESS_RULES kalau fitur itu belum
            // pernah disave secara eksplisit lewat Access Rule -- jangan dihitung ulang
            // di sini (dulu ada bug: dihitung ulang pakai s.accessRules yang defaultnya
            // selalu ada sebagai array, jadi checkbox Access Rule keliatan kosong/publik
            // padahal defaultnya owner/admin-only).
            const s = savedMap[key]
            const accessRules = s ? s.accessRules : (DEFAULT_ACCESS_RULES[key] || [])
            groups[cat].push({
                featureKey: key,
                aliases: cmds,
                description: plugin.description || plugin.help || '',
                enabled: s ? s.enabled !== false : true,
                customResponse: (s && s.customResponse) || null,
                customCommand: (s && s.customCommand) || null,
                accessRule: accessRules.length ? accessRules.join('+') : 'public',
                accessRules
            })
        }
        // sort keys in each group
        for (const cat of Object.keys(groups)) {
            groups[cat].sort((a, b) => a.featureKey.localeCompare(b.featureKey))
        }

        res.json({
            groups,
            categories: Object.keys(groups).sort(),
            isPremium: premium,
            accessRules: ACCESS_FLAGS
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.put('/bots/:botId/features/:featureKey', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const premium = ((await isAccountPremium(req.account._id.toString())) || (await isBotPremium(bot._id.toString())))
        const body = req.body || {}
        const patch = {}

        // Free: only ON/OFF for basic features
        if (body.enabled !== undefined) patch.enabled = !!body.enabled

        if (premium) {
            if (body.customResponse !== undefined) patch.customResponse = body.customResponse
            if (body.customCommand !== undefined) patch.customCommand = body.customCommand
            if (body.accessRules !== undefined || body.accessRule !== undefined) {
                const rules = body.accessRules !== undefined
                    ? (Array.isArray(body.accessRules) ? body.accessRules : [])
                    : body.accessRule
                patch.accessRules = rules
            }
        } else if (body.customResponse || body.customCommand || body.accessRule || body.accessRules) {
            return res.status(403).json({ error: 'Custom response/command/access rule hanya Premium' })
        }

        await setFeatureSetting(bot.sessionId, req.params.featureKey, patch)
        invalidateFeatureCache(bot.sessionId, req.params.featureKey)
        const updated = await getFeatureSetting(bot.sessionId, req.params.featureKey)
        res.json({ feature: updated })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})


// ---------- Premium AKUN (bukan per bot) ----------
router.get('/premium', authMiddleware, loadAccount, async (req, res) => {
    try {
        const sub = await getAccountSubscription(req.account._id.toString())
        const orders = await findOrdersByAccount(req.account._id.toString())
        res.json({
            subscription: sub,
            isPremium: await isAccountPremium(req.account._id.toString()),
            price: PREMIUM_PRICE,
            plans: PREMIUM_PLANS,
            orders: orders.slice(0, 10)
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/premium/order', authMiddleware, loadAccount, async (req, res) => {
    try {
        const { method = 'qris', name, duration } = req.body || {}
        const plan = resolvePlan(duration)
        const payment = await sociabuzz.createPayment(plan.price, {
            name: name || req.account.name || 'ZoraBot User',
            method,
            message: `ZoraBot Premium ${plan.label} Account - ${req.account.email || req.account._id}`
        })
        const orderId = payment.id || payment.trxId || ('ORD-' + Date.now())
        const expiresAt = payment.expired_at || new Date(Date.now() + 30 * 60 * 1000).toISOString()
        const pi = payment.payment_info || payment.paymentInfo || {}
        const paymentInfo = {
            ...payment,
            ...pi,
            qr_string: pi.qr_string || payment.qr_string || null,
            pending_url: pi.pending_url || payment.pending_url || null,
            method: pi.method || method,
            redirect_url: pi.redirect_url || pi.payment_link || payment.redirect_url || null,
            payment_link: pi.payment_link || pi.redirect_url || null
        }
        if (paymentInfo.qr_string) {
            paymentInfo.qr_image = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(paymentInfo.qr_string)
        }
        await createOrder({
            accountId: req.account._id.toString(),
            botId: null,
            orderId,
            amount: payment.total_amount || plan.price,
            duration: duration || '30d',
            paymentInfo,
            expiresAt
        })
        res.json({
            orderId,
            amount: payment.total_amount || plan.price,
            baseAmount: plan.price,
            duration: duration || '30d',
            expiresAt,
            payment: paymentInfo
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/premium/check', authMiddleware, loadAccount, async (req, res) => {
    try {
        const { orderId } = req.body || {}
        if (!orderId) return res.status(400).json({ error: 'orderId wajib' })
        const order = await findOrder(orderId)
        if (!order || order.accountId !== req.account._id.toString()) {
            return res.status(404).json({ error: 'Order not found' })
        }
        if (order.status === 'paid') return res.json({ status: 'paid', already: true })
        if (order.status === 'cancelled') return res.json({ status: 'cancelled' })
        if (isOrderExpired(order)) {
            await markOrderChecked(orderId, 'expired')
            return res.json({ status: 'expired', message: 'Order kedaluwarsa (max 30 menit). Buat order baru.' })
        }
        let paid = false
        try {
            const pendingUrl = order.paymentInfo?.pending_url || order.paymentInfo?.url || order.paymentInfo?.pendingUrl
            if (pendingUrl && typeof sociabuzz.statusPayment === 'function') {
                const result = await sociabuzz.statusPayment(pendingUrl)
                const st = (result?.status || result?.payment_status || '').toString().toLowerCase()
                paid = st === 'paid' || st === 'success' || st === 'settlement' || result?.paid === true
            } else {
                const trx = typeof sociabuzz.getTransaction === 'function' ? await sociabuzz.getTransaction(orderId) : null
                if (trx) {
                    const st = (trx.status || '').toString().toLowerCase()
                    paid = st === 'paid' || st === 'success' || trx.paid === true
                }
            }
        } catch (err) {
            console.error('SociaBuzz check error:', err.message)
        }
        if (paid) {
            await markOrderChecked(orderId, 'paid')
            const plan = resolvePlan(order.duration)
            await activateAccountPremium(req.account._id.toString(), { months: plan.months, days: plan.days })
            await pushNotification(req.account._id.toString(), {
                type: 'success',
                title: 'Premium aktif',
                body: 'Pembayaran berhasil. Plan ' + (plan.label || 'Premium') + ' sudah aktif.',
                link: '/upgrade'
            })
            return res.json({ status: 'paid', activated: true })
        }
        await markOrderChecked(orderId, 'pending')
        res.json({ status: 'pending' })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/premium/cancel', authMiddleware, loadAccount, async (req, res) => {
    try {
        const { orderId } = req.body || {}
        if (!orderId) return res.status(400).json({ error: 'orderId wajib' })
        const result = await cancelOrder(orderId, req.account._id.toString())
        if (!result.ok) return res.status(400).json({ error: result.error })
        res.json({ ok: true, status: 'cancelled' })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// ---------- Premium / Payment (SociaBuzz, manual check) ----------
router.post('/bots/:botId/premium/order', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const { method = 'qris', name } = req.body || {}

        const payment = await sociabuzz.createPayment(PREMIUM_PRICE, {
            name: name || req.account.name || 'ZoraBot User',
            method,
            message: `ZoraBot Premium - ${bot.sessionId}`
        })

        const orderId = payment.id || payment.trxId || ('ORD-' + Date.now())
        const expiresAt = payment.expired_at || new Date(Date.now() + 30 * 60 * 1000).toISOString()
        const pi = payment.payment_info || payment.paymentInfo || {}
        // Flatten useful fields for frontend
        const paymentInfo = {
            ...payment,
            ...pi,
            qr_string: pi.qr_string || payment.qr_string || null,
            pending_url: pi.pending_url || payment.pending_url || null,
            method: pi.method || method
        }
        if (paymentInfo.qr_string) {
            paymentInfo.qr_image = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(paymentInfo.qr_string)
        }

        await createOrder({
            accountId: req.account._id.toString(),
            botId: bot._id.toString(),
            orderId,
            amount: payment.total_amount || PREMIUM_PRICE,
            paymentInfo,
            expiresAt
        })

        res.json({
            orderId,
            amount: payment.total_amount || PREMIUM_PRICE,
            baseAmount: PREMIUM_PRICE,
            expiresAt,
            payment: paymentInfo
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/bots/:botId/premium/check', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const { orderId } = req.body || {}
        if (!orderId) return res.status(400).json({ error: 'orderId wajib' })

        const order = await findOrder(orderId)
        if (!order || order.accountId !== req.account._id.toString()) {
            return res.status(404).json({ error: 'Order not found' })
        }
        if (order.status === 'paid') {
            return res.json({ status: 'paid', already: true })
        }
        if (order.status === 'cancelled') {
            return res.json({ status: 'cancelled' })
        }
        if (isOrderExpired(order)) {
            await markOrderChecked(orderId, 'expired')
            return res.json({ status: 'expired', message: 'Order kedaluwarsa (max 30 menit). Buat order baru.' })
        }

        // Manual check against SociaBuzz (no automatic polling)
        let paid = false
        try {
            const pendingUrl = order.paymentInfo?.pending_url || order.paymentInfo?.url || order.paymentInfo?.pendingUrl
            if (pendingUrl && typeof sociabuzz.statusPayment === 'function') {
                const result = await sociabuzz.statusPayment(pendingUrl)
                const st = (result?.status || result?.payment_status || '').toString().toLowerCase()
                paid = st === 'paid' || st === 'success' || st === 'settlement' || result?.paid === true
            } else {
                const trx = typeof sociabuzz.getTransaction === 'function' ? await sociabuzz.getTransaction(orderId) : null
                if (trx) {
                    const st = (trx.status || '').toString().toLowerCase()
                    paid = st === 'paid' || st === 'success' || trx.paid === true
                }
            }
        } catch (err) {
            console.error('SociaBuzz check error:', err.message)
        }

        if (paid) {
            await markOrderChecked(orderId, 'paid')
            await activateAccountPremium(req.account._id.toString(), { months: 1 })
            await pushNotification(req.account._id.toString(), {
                type: 'success',
                title: 'Premium aktif',
                body: 'Pembayaran berhasil. Premium 30 hari aktif.',
                link: '/upgrade'
            })
            return res.json({ status: 'paid', activated: true })
        }

        await markOrderChecked(orderId, 'pending')
        res.json({ status: 'pending' })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.get('/bots/:botId/premium', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const sub = await getSubscription(bot._id.toString())
        const orders = await findOrdersByAccount(req.account._id.toString())
        const botOrders = orders.filter(o => o.botId === bot._id.toString())
        res.json({
            subscription: sub,
            isPremium: await isBotPremium(bot._id.toString()),
            price: PREMIUM_PRICE,
            orders: botOrders
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})




router.post('/bots/:botId/premium/cancel', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const { orderId } = req.body || {}
        if (!orderId) return res.status(400).json({ error: 'orderId wajib' })
        const result = await cancelOrder(orderId, req.account._id.toString())
        if (!result.ok) return res.status(400).json({ error: result.error })
        res.json({ ok: true, status: 'cancelled' })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// Restart bot runtime (apply settings / reconnect)



router.post('/bots/:botId/power', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const enabled = req.body?.enabled !== false
        await updateOwnedBot(bot._id.toString(), req.account._id.toString(), { enabled })
        const inst = botManager.get(bot.sessionId)
        if (inst) inst.enabled = enabled
        if (!enabled) {
            await botManager.stopBot(bot.sessionId, { clearSession: false })
            await setBotStatus(bot.sessionId, 'disconnected').catch(() => {})
        } else {
            // Nyalakan lagi tanpa pairing (session tetap)
            await botManager.startBot(bot.sessionId, { ...bot, enabled: true }, { isRestart: true })
        }
        res.json({ ok: true, enabled, state: botManager.getState(bot.sessionId) })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/bots/:botId/restart', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        await botManager.stopBot(bot.sessionId, { clearSession: false })
        // short delay then start with existing session
        await new Promise(r => setTimeout(r, 800))
        const state = await botManager.startBot(bot.sessionId, bot, { isRestart: true })
        res.json({ ok: true, state })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// ---------- Live chatlog (ring buffer in-memory, owned bot only) ----------
router.get('/bots/:botId/chatlog', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const logs = getChatLog(bot.sessionId)
        res.json({ logs })
    } catch (e) {
        res.status(500).json({ error: publicError(e) })
    }
})

// ---------- Database export / import (database.json) ----------
router.get('/bots/:botId/database', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const db = await getMongoDb()
        const sid = bot.sessionId
        const [botData, botSettings, features, sub, authDocs] = await Promise.all([
            db.collection(COLLECTIONS.BOT_DATA).findOne({ botId: sid }),
            db.collection(COLLECTIONS.BOT_SETTINGS).findOne({ botId: sid }),
            db.collection(COLLECTIONS.FEATURE_SETTINGS).find({ botId: sid }).toArray(),
            db.collection(COLLECTIONS.SUBSCRIPTIONS).findOne({ botId: bot._id.toString() }),
            db.collection(COLLECTIONS.WA_AUTH).find({ _id: { $regex: `^${sid}:` } }).toArray()
        ])
        const includeSession = req.query.session === '1'
        const payload = {
            format: 'zorabot-database',
            version: 1,
            exportedAt: new Date().toISOString(),
            bot: {
                botName: bot.botName,
                sessionId: sid,
                ownerNumber: bot.ownerNumber,
                identity: bot.identity
            },
            botData: botData ? {
                users: botData.users || {},
                chats: botData.chats || {},
                contacts: botData.contacts || {},
                lid_mapping: botData.lid_mapping || {},
                msgs: botData.msgs || {}
            } : { users: {}, chats: {}, contacts: {}, lid_mapping: {}, msgs: {} },
            botSettings: botSettings || {},
            featureSettings: features || [],
            subscription: sub || null,
            session: includeSession ? authDocs.map(d => ({ _id: d._id, value: d.value })) : null
        }
        res.setHeader('Content-Disposition', `attachment; filename="database-${sid}.json"`)
        res.json(payload)
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/bots/:botId/database/import', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const body = req.body || {}
        if (body.format && body.format !== 'zorabot-database') {
            return res.status(400).json({ error: 'Format file tidak dikenali. Gunakan export ZoraBot.' })
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || !validateImportValue(body)) {
            return res.status(400).json({ error: 'Data import terlalu besar, terlalu dalam, atau memiliki key yang tidak valid' })
        }
        const db = await getMongoDb()
        const sid = bot.sessionId
        const data = body.botData || body
        const users = importMap(data.users || body.users)
        const chats = importMap(data.chats || body.chats)
        const contacts = importMap(data.contacts || body.contacts)
        const lid_mapping = importMap(data.lid_mapping || body.lid_mapping)
        const msgs = importMap(data.msgs || body.msgs)

        await db.collection(COLLECTIONS.BOT_DATA).updateOne(
            { botId: sid },
            { $set: { botId: sid, users, chats, contacts, lid_mapping, msgs, updatedAt: new Date() } },
            { upsert: true }
        )

        if (body.botSettings && typeof body.botSettings === 'object') {
            const { _id, botId, ...settings } = body.botSettings
            await db.collection(COLLECTIONS.BOT_SETTINGS).updateOne(
                { botId: sid },
                { $set: { ...settings, botId: sid, updatedAt: new Date() } },
                { upsert: true }
            )
        }

        if (Array.isArray(body.featureSettings)) {
            for (const f of body.featureSettings) {
                if (!f.featureKey) continue
                await db.collection(COLLECTIONS.FEATURE_SETTINGS).updateOne(
                    { botId: sid, featureKey: f.featureKey },
                    { $set: {
                        botId: sid,
                        featureKey: f.featureKey,
                        enabled: f.enabled !== false,
                        customResponse: f.customResponse || null,
                        customCommand: f.customCommand || null,
                        accessRule: f.accessRule || 'public',
                        updatedAt: new Date()
                    }},
                    { upsert: true }
                )
            }
        }

        // Import WhatsApp session (opsional)
        let sessionImported = 0
        if (Array.isArray(body.session) && body.session.length) {
            // hapus session lama bot ini
            await db.collection(COLLECTIONS.WA_AUTH).deleteMany({ _id: { $regex: `^${sid}:` } })
            for (const doc of body.session) {
                if (!doc || doc.value == null) continue
                // remap id ke sessionId bot target
                let id = String(doc._id || '')
                const colon = id.indexOf(':')
                const key = colon >= 0 ? id.slice(colon + 1) : id
                const newId = `${sid}:${key}`
                await db.collection(COLLECTIONS.WA_AUTH).updateOne(
                    { _id: newId },
                    { $set: { value: doc.value } },
                    { upsert: true }
                )
                sessionImported++
            }
        }

        if (body.bot?.botName || body.bot?.identity) {
            await updateOwnedBot(bot._id.toString(), req.account._id.toString(), {
                ...(body.bot.botName ? { botName: body.bot.botName } : {}),
                ...(body.bot.identity ? { identity: body.bot.identity } : {}),
                ...(body.bot.ownerNumber ? { ownerNumber: body.bot.ownerNumber } : {})
            })
        }

        res.json({
            ok: true,
            imported: {
                users: Object.keys(users).length,
                chats: Object.keys(chats).length,
                sessionKeys: sessionImported
            },
            note: sessionImported
                ? 'Session diimpor. Restart/reconnect bot agar session dipakai.'
                : 'Data bot diimpor. Session tidak disertakan (centang session saat export jika perlu).'
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// ---------- Dashboard metrics (owner-scoped, in-memory) ----------
router.get('/bots/:botId/metrics', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        res.json({ metrics: getSessionMetrics(bot.sessionId) })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to load metrics') })
    }
})

router.get('/metrics', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bots = await findBotsByOwner(req.account._id)
        const sessionIds = bots.map(b => b.sessionId).filter(Boolean)
        const metrics = getAggregateMetrics(sessionIds)
        const anyPremium = await isAccountPremium(req.account._id.toString())
        res.json({
            metrics,
            plan: anyPremium ? 'premium' : 'free',
            bots: bots.map(b => ({
                id: b._id.toString(),
                sessionId: b.sessionId,
                botName: b.botName,
                status: b.status,
                metrics: getSessionMetrics(b.sessionId)
            }))
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to load metrics') })
    }
})

// ---------- Admin panel ----------

router.get('/admin/platform', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const settings = await getPlatformSettings()
        res.json({ settings })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to load platform settings') })
    }
})

router.put('/admin/platform', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const body = req.body || {}
        const settings = await setPlatformSettings({
            freeAdsEnabled: body.freeAdsEnabled,
            adsText: body.adsText,
            adsPerDay: body.adsPerDay
        })
        res.json({ settings })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/admin/ads/send', authMiddleware, loadAccount, requireAdmin, adsSendLimit, async (req, res) => {
    try {
        const body = req.body || {}
        const target = body.target || 'all' // 'all' atau sessionId bot tertentu
        const text = (body.text || '').trim()
        if (!text) return res.status(400).json({ error: 'Ad text is required' })
        if (text.length > 4000) return res.status(400).json({ error: 'Ad text is too long (max 4000 characters)' })

        const results = await sendAdsManually({
            target,
            text,
            skipPremium: body.skipPremium !== false
        })

        if (!results.length) return res.status(404).json({ error: 'No matching connected bots' })

        res.json({
            ok: true,
            totalSent: results.reduce((a, r) => a + (r.sent || 0), 0),
            results
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.get('/admin/overview', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const db = await getMongoDb()
        const [userCount, botCount, orderCount, connectedCount, orders] = await Promise.all([
            db.collection(COLLECTIONS.ACCOUNTS).countDocuments({}),
            db.collection(COLLECTIONS.BOTS).countDocuments({}),
            db.collection(COLLECTIONS.ORDERS).countDocuments({}),
            db.collection(COLLECTIONS.BOTS).countDocuments({ status: 'connected' }),
            db.collection(COLLECTIONS.ORDERS).find({}).sort({ createdAt: -1 }).limit(30).toArray()
        ])
        res.json({
            stats: {
                users: userCount,
                bots: botCount,
                orders: orderCount,
                connected: connectedCount
            },
            orders: orders.map(o => ({
                orderId: o.orderId,
                accountId: o.accountId,
                botId: o.botId,
                amount: o.amount,
                status: o.status,
                createdAt: o.createdAt
            }))
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to load overview') })
    }
})

router.get('/admin/users', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const result = await listAccountsPaged({
            page: req.query.page,
            limit: req.query.limit,
            q: req.query.q,
            role: req.query.role,
            sort: req.query.sort
        })
        // Attach bot counts + premium (bounded)
        const db = await getMongoDb()
        const ids = result.accounts.map(a => {
            try { return new ObjectId(a.id) } catch { return null }
        }).filter(Boolean)
        let botCounts = {}
        let premiumSet = new Set()
        if (ids.length) {
            const bots = await db.collection(COLLECTIONS.BOTS).aggregate([
                { $match: { ownerId: { $in: ids } } },
                { $group: { _id: '$ownerId', count: { $sum: 1 } } }
            ]).toArray()
            for (const b of bots) botCounts[b._id.toString()] = b.count
            const subs = await db.collection(COLLECTIONS.SUBSCRIPTIONS).find({
                accountId: { $in: ids.map(i => i.toString()) },
                plan: 'premium',
                expiresAt: { $gt: new Date() }
            }).project({ accountId: 1 }).toArray()
            for (const s of subs) if (s.accountId) premiumSet.add(String(s.accountId))
        }
        result.accounts = result.accounts.map(a => ({
            ...a,
            botCount: botCounts[a.id] || 0,
            plan: premiumSet.has(a.id) ? 'premium' : 'free'
        }))
        res.json(result)
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to list users') })
    }
})

router.get('/admin/bots', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const result = await listBotsPaged({
            page: req.query.page,
            limit: req.query.limit,
            q: req.query.q,
            status: req.query.status,
            sort: req.query.sort
        })
        // Enrich with live session state (WhatsApp number + real connection status)
        result.bots = (result.bots || []).map((b) => {
            const state = botManager.getState(b.sessionId) || {}
            const liveStatus = state.status || b.status || 'disconnected'
            return {
                ...b,
                status: liveStatus,
                statusLabel: statusLabel(liveStatus),
                waNumber: state.waNumber || null,
                waName: state.waName || null,
                lastError: state.lastError || null,
                enabled: b.enabled !== false
            }
        })
        res.json(result)
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to list bots') })
    }
})

/** Admin: view one bot's stored settings (by bot document id). Scoped to that bot only. */
router.get('/admin/bots/:id/settings', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const oid = safeObjectId(req.params.id)
        if (!oid) return res.status(400).json({ error: 'Invalid ID' })
        const db = await getMongoDb()
        const bot = await db.collection(COLLECTIONS.BOTS).findOne({ _id: oid })
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const settingsDoc = await db.collection(COLLECTIONS.BOT_SETTINGS).findOne({ botId: bot.sessionId })
        const state = botManager.getState(bot.sessionId) || {}
        const liveStatus = state.status || bot.status || 'disconnected'
        res.json({
            bot: {
                id: bot._id.toString(),
                sessionId: bot.sessionId,
                botName: bot.botName,
                ownerId: bot.ownerId?.toString?.() || null,
                ownerNumber: bot.ownerNumber || null,
                status: liveStatus,
                statusLabel: statusLabel(liveStatus),
                waNumber: state.waNumber || null,
                waName: state.waName || null,
                enabled: bot.enabled !== false,
                identity: bot.identity || null,
                createdAt: bot.createdAt
            },
            settings: settingsDoc || {}
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to load bot settings') })
    }
})

router.get('/admin/errors', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const result = await listCommandErrorsAdmin({
            page: req.query.page,
            limit: req.query.limit,
            q: req.query.q,
            botId: req.query.botId
        })
        res.json(result)
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to list errors') })
    }
})

router.post('/admin/accounts/:id/role', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        if (!safeObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' })
        const role = req.body?.role === 'admin' ? 'admin' : 'user'
        // Prevent locking yourself out of the last admin path by demoting self
        if (role === 'user' && String(req.params.id) === String(req.account._id)) {
            return res.status(400).json({ error: 'You cannot demote your own admin role' })
        }
        await setAccountRole(req.params.id, role)
        res.json({ ok: true, role })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to update role') })
    }
})


router.delete('/admin/accounts/:id', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        if (!safeObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' })
        if (String(req.params.id) === String(req.account._id)) {
            return res.status(400).json({ error: 'You cannot delete your own account' })
        }
        const ok = await deleteAccountById(req.params.id)
        if (!ok) return res.status(404).json({ error: 'Account not found' })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to delete account') })
    }
})

router.post('/admin/bots/:id/premium', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        if (!safeObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' })
        const months = Math.min(24, Math.max(1, Number(req.body?.months) || 1))
        await activatePremium(req.params.id, { months })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: publicError(e) })
    }
})

router.delete('/admin/bots/:id', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const oid = safeObjectId(req.params.id)
        if (!oid) return res.status(400).json({ error: 'Invalid ID' })
        const db = await getMongoDb()
        const bot = await db.collection(COLLECTIONS.BOTS).findOne({ _id: oid })
        if (bot?.sessionId) {
            try { await botManager.stopBot(bot.sessionId, { clearSession: true }) } catch {}
        }
        await deleteBotById(req.params.id)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: publicError(e) })
    }
})

router.post('/admin/bots/:id/status', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const oid = safeObjectId(req.params.id)
        if (!oid) return res.status(400).json({ error: 'Invalid ID' })
        const db = await getMongoDb()
        const bot = await db.collection(COLLECTIONS.BOTS).findOne({ _id: oid })
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const action = req.body?.action
        if (action === 'stop') {
            await botManager.stopBot(bot.sessionId, { clearSession: !!req.body.clearSession })
        } else if (action === 'start') {
            await botManager.startBot(bot.sessionId, bot, {})
        } else {
            return res.status(400).json({ error: 'action harus stop atau start' })
        }
        res.json({ ok: true, state: botManager.getState(bot.sessionId) })
    } catch (e) {
        res.status(500).json({ error: publicError(e) })
    }
})






// ---------- Notifications ----------
router.get('/notifications', authMiddleware, loadAccount, async (req, res) => {
    try {
        const items = await listNotifications(req.account._id.toString(), { limit: 30 })
        const unread = await countUnread(req.account._id.toString())
        res.json({
            notifications: items.map(n => ({
                id: n._id.toString(),
                type: n.type,
                title: n.title,
                body: n.body,
                link: n.link,
                read: !!n.read,
                createdAt: n.createdAt
            })),
            unread
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

router.post('/notifications/read', authMiddleware, loadAccount, async (req, res) => {
    try {
        const ids = (req.body && req.body.ids) || null
        await markNotificationsRead(req.account._id.toString(), ids)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// ---------- Orders history ----------
router.get('/orders', authMiddleware, loadAccount, async (req, res) => {
    try {
        const list = await findOrdersByAccount(req.account._id.toString())
        res.json({
            orders: list.map(o => ({
                orderId: o.orderId,
                amount: o.amount,
                duration: o.duration,
                status: o.status,
                createdAt: o.createdAt,
                expiresAt: o.expiresAt,
                checkedAt: o.checkedAt,
                cancelledAt: o.cancelledAt
            }))
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})

// ---------- Command errors ----------
router.delete('/orders/:orderId', authMiddleware, loadAccount, async (req, res) => {
    try {
        const orderId = String(req.params.orderId || '').trim()
        if (!orderId) return res.status(400).json({ error: 'Order ID is required' })
        const result = await deleteOrder(orderId, req.account._id.toString())
        if (!result.ok) return res.status(404).json({ error: result.error || 'Order not found' })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Failed to delete order') })
    }
})

router.get('/bots/:botId/errors', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot not found' })
        const errors = await listCommandErrors(bot.sessionId, { limit: 25 })
        res.json({
            errors: errors.map(e => ({
                cmd: e.cmd,
                message: e.message,
                createdAt: e.createdAt
            }))
        })
    } catch (e) {
        res.status(500).json({ error: publicError(e, 'Something went wrong') })
    }
})


export default router
