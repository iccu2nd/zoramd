import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { authMiddleware, loadAccount, register, login } from '../auth.js'
import {
    createBot, findBotsByOwner, findOwnedBot, updateOwnedBot, findBotBySessionId, setBotStatus,
    listAllAccounts, listAllBots, setAccountRole, deleteBotById, updateAccount, findAccountById
} from '../../lib/db/accounts.js'
import { getSubscription, isBotPremium, activatePremium } from '../../lib/db/subscription.js'
import { getAllFeatureSettings, setFeatureSetting, getFeatureSetting, ACCESS_RULES } from '../../lib/db/featureSettings.js'
import { createOrder, findOrder, findOrdersByAccount, markOrderChecked, cancelOrder, isOrderExpired } from '../../lib/db/orders.js'
import { getMongoDb } from '../../lib/db/mongo.js'
import { COLLECTIONS } from '../../lib/db/schema.js'
import botManager from '../../lib/botManager.js'
import * as sociabuzz from '../../lib/sociabuzz.js'

const router = Router()

// Health (no secrets)
router.get('/health', (req, res) => {
    res.json({ ok: true, service: 'zorabot', time: new Date().toISOString() })
})


const PREMIUM_PRICE = 25000

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



function isAdminAccount(account) {
    if (!account) return false
    if (account.role === 'admin') return true
    const allow = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (account.email && allow.includes(String(account.email).toLowerCase())) return true
    return false
}

function requireAdmin(req, res, next) {
    if (!isAdminAccount(req.account)) {
        return res.status(403).json({ error: 'Akses admin saja' })
    }
    next()
}

// ---------- Auth ----------
router.post('/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body || {}
        const { account, token } = await register({ email, password, name })
        res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 })
        res.json({
            token,
            user: { id: account._id, email: account.email, name: account.name }
        })
    } catch (e) {
        res.status(400).json({ error: e.message })
    }
})

router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body || {}
        const { account, token } = await login({ email, password })
        res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 })
        res.json({
            token,
            user: { id: account._id, email: account.email, name: account.name }
        })
    } catch (e) {
        res.status(400).json({ error: e.message })
    }
})

router.post('/auth/logout', (req, res) => {
    res.clearCookie('token')
    res.json({ ok: true })
})

router.get('/auth/me', authMiddleware, loadAccount, (req, res) => {
    res.json({
        user: {
            id: req.account._id,
            email: req.account.email,
            name: req.account.name,
            role: req.account.role || 'user',
            isAdmin: isAdminAccount(req.account)
        }
    })
})

// ---------- Bots ----------
router.get('/bots', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bots = await findBotsByOwner(req.account._id)
        const enriched = await Promise.all(bots.map(async (b) => {
            const sub = await getSubscription(b._id.toString())
            const state = botManager.getState(b.sessionId)
            return {
                id: b._id.toString(),
                sessionId: b.sessionId,
                botName: b.botName,
                ownerNumber: b.ownerNumber,
                identity: b.identity,
                status: state.status || b.status,
                enabled: b.enabled !== false,
                waName: state.waName || null,
                waNumber: state.waNumber || null,
                profilePic: state.profilePic || null,
                plan: sub.plan,
                premiumExpiresAt: sub.expiresAt,
                createdAt: b.createdAt
            }
        }))
        // plan sudah dari getSubscription; isBotPremium untuk cek expiry
        let anyPremium = false
        for (const b of enriched) {
            if (b.plan === 'premium' && await isBotPremium(b.id)) {
                anyPremium = true
                b.plan = 'premium'
            } else if (b.plan === 'premium') {
                b.plan = 'free' // expired
            }
        }
        const maxBots = anyPremium ? 3 : 1
        res.json({
            bots: enriched,
            limits: { max: maxBots, used: enriched.length, plan: anyPremium ? 'premium' : 'free' }
        })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/bots', authMiddleware, loadAccount, async (req, res) => {
    try {
        const { botName, ownerNumber } = req.body || {}
        const existing = await findBotsByOwner(req.account._id)

        // Cek apakah user punya minimal 1 bot premium (plan aktif)
        let anyPremium = false
        for (const b of existing) {
            if (await isBotPremium(b._id.toString())) {
                anyPremium = true
                break
            }
        }
        const maxBots = anyPremium ? 3 : 1
        if (existing.length >= maxBots) {
            return res.status(403).json({
                error: anyPremium
                    ? 'Batas Premium: maksimal 3 bot. Hapus bot lain dulu.'
                    : 'Batas Free: maksimal 1 bot. Upgrade Premium untuk hingga 3 bot.'
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
        res.status(400).json({ error: e.message })
    }
})

router.get('/bots/:botId', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
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
        res.status(500).json({ error: e.message })
    }
})

// Connect bot (start session)
router.post('/bots/:botId/connect', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
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
        const state = await botManager.startBot(bot.sessionId, bot, {
            phoneNumber: forcePairing ? phone : undefined,
            forcePairing,
            // pairing selalu session bersih agar tidak Stream Errored dari session setengah
            clearSessionFirst: forcePairing || method === 'qr'
        })
        res.json({ state })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/bots/:botId/disconnect', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const { clearSession } = req.body || {}
        await botManager.stopBot(bot.sessionId, { clearSession: !!clearSession })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.get('/bots/:botId/status', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const state = botManager.getState(bot.sessionId)
        res.json({ state })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ---------- Bot Settings (premium gated for identity) ----------
router.get('/bots/:botId/settings', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const premium = await isBotPremium(bot._id.toString())
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
        res.status(500).json({ error: e.message })
    }
})

router.put('/bots/:botId/settings', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const premium = await isBotPremium(bot._id.toString())
        const body = req.body || {}

        // Free users: limited settings only
        const allowedFree = ['mode', 'autoread', 'autotyping', 'noprefix', 'gconly', 'enabled']
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
                await updateOwnedBot(bot._id.toString(), req.account._id.toString(), {
                    botName: identity.botName || bot.botName,
                    ownerNumber: identity.ownerNumber || bot.ownerNumber,
                    identity
                })
            }
        } else if (body.identity || body.botName || body.ownerNumber) {
            return res.status(403).json({ error: 'Custom identity hanya tersedia untuk Premium' })
        }

        if (Object.keys(patchSettings).length) {
            const db = await getMongoDb()
            await db.collection(COLLECTIONS.BOT_SETTINGS).updateOne(
                { botId: bot.sessionId },
                { $set: { ...patchSettings, updatedAt: new Date() } },
                { upsert: true }
            )
        }

        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ---------- Feature Settings ----------
router.get('/bots/:botId/features', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const premium = await isBotPremium(bot._id.toString())
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
            const s = savedMap[key] || {}
            groups[cat].push({
                featureKey: key,
                aliases: cmds,
                description: plugin.description || plugin.help || '',
                enabled: s.enabled !== false,
                customResponse: s.customResponse || null,
                customCommand: s.customCommand || null,
                accessRule: s.accessRule || 'public'
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
            accessRules: ACCESS_RULES
        })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.put('/bots/:botId/features/:featureKey', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const premium = await isBotPremium(bot._id.toString())
        const body = req.body || {}
        const patch = {}

        // Free: only ON/OFF for basic features
        if (body.enabled !== undefined) patch.enabled = !!body.enabled

        if (premium) {
            if (body.customResponse !== undefined) patch.customResponse = body.customResponse
            if (body.customCommand !== undefined) patch.customCommand = body.customCommand
            if (body.accessRule !== undefined) {
                if (!ACCESS_RULES.includes(body.accessRule)) {
                    return res.status(400).json({ error: 'accessRule tidak valid' })
                }
                patch.accessRule = body.accessRule
            }
        } else if (body.customResponse || body.customCommand || body.accessRule) {
            return res.status(403).json({ error: 'Custom response/command/access rule hanya Premium' })
        }

        await setFeatureSetting(bot.sessionId, req.params.featureKey, patch)
        const updated = await getFeatureSetting(bot.sessionId, req.params.featureKey)
        res.json({ feature: updated })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ---------- Premium / Payment (SociaBuzz, manual check) ----------
router.post('/bots/:botId/premium/order', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
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
        res.status(500).json({ error: e.message || 'Gagal membuat order' })
    }
})

router.post('/bots/:botId/premium/check', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const { orderId } = req.body || {}
        if (!orderId) return res.status(400).json({ error: 'orderId wajib' })

        const order = await findOrder(orderId)
        if (!order || order.accountId !== req.account._id.toString()) {
            return res.status(404).json({ error: 'Order tidak ditemukan' })
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
                const trx = typeof sociabuzz.getTransaction === 'function' ? sociabuzz.getTransaction(orderId) : null
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
            await activatePremium(bot._id.toString(), { months: 1 })
            return res.json({ status: 'paid', activated: true })
        }

        await markOrderChecked(orderId, 'pending')
        res.json({ status: 'pending' })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.get('/bots/:botId/premium', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
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
        res.status(500).json({ error: e.message })
    }
})




router.post('/bots/:botId/premium/cancel', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const { orderId } = req.body || {}
        if (!orderId) return res.status(400).json({ error: 'orderId wajib' })
        const result = await cancelOrder(orderId, req.account._id.toString())
        if (!result.ok) return res.status(400).json({ error: result.error })
        res.json({ ok: true, status: 'cancelled' })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// Restart bot runtime (apply settings / reconnect)



router.post('/bots/:botId/power', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
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
        res.status(500).json({ error: e.message })
    }
})

router.post('/bots/:botId/restart', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        await botManager.stopBot(bot.sessionId, { clearSession: false })
        // short delay then start with existing session
        await new Promise(r => setTimeout(r, 800))
        const state = await botManager.startBot(bot.sessionId, bot, { isRestart: true })
        res.json({ ok: true, state })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ---------- Database export / import (database.json) ----------
router.get('/bots/:botId/database', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
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
        res.status(500).json({ error: e.message })
    }
})

router.post('/bots/:botId/database/import', authMiddleware, loadAccount, async (req, res) => {
    try {
        const bot = await findOwnedBot(req.params.botId, req.account._id)
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const body = req.body || {}
        if (body.format && body.format !== 'zorabot-database') {
            return res.status(400).json({ error: 'Format file tidak dikenali. Gunakan export ZoraBot.' })
        }
        const db = await getMongoDb()
        const sid = bot.sessionId
        const data = body.botData || body
        const users = data.users || body.users || {}
        const chats = data.chats || body.chats || {}
        const contacts = data.contacts || body.contacts || {}
        const lid_mapping = data.lid_mapping || body.lid_mapping || {}
        const msgs = data.msgs || body.msgs || {}

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
        res.status(500).json({ error: e.message })
    }
})

// ---------- Admin panel ----------
router.get('/admin/overview', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const db = await getMongoDb()
        const [accounts, bots, orders] = await Promise.all([
            listAllAccounts(300),
            listAllBots(500),
            db.collection(COLLECTIONS.ORDERS).find({}).sort({ createdAt: -1 }).limit(100).toArray()
        ])
        res.json({
            stats: {
                users: accounts.length,
                bots: bots.length,
                orders: orders.length,
                connected: bots.filter(b => b.status === 'connected').length
            },
            accounts: accounts.map(a => ({
                id: a._id.toString(),
                email: a.email,
                name: a.name,
                role: a.role || 'user',
                createdAt: a.createdAt
            })),
            bots: bots.map(b => ({
                id: b._id.toString(),
                sessionId: b.sessionId,
                botName: b.botName,
                ownerId: b.ownerId?.toString(),
                status: b.status,
                createdAt: b.createdAt
            })),
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
        res.status(500).json({ error: e.message })
    }
})

router.post('/admin/accounts/:id/role', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const role = req.body?.role === 'admin' ? 'admin' : 'user'
        await setAccountRole(req.params.id, role)
        res.json({ ok: true, role })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/admin/bots/:id/premium', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const months = Number(req.body?.months) || 1
        await activatePremium(req.params.id, { months })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.delete('/admin/bots/:id', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const db = await getMongoDb()
        const bot = await db.collection(COLLECTIONS.BOTS).findOne({ _id: new ObjectId(req.params.id) })
        if (bot?.sessionId) {
            try { await botManager.stopBot(bot.sessionId, { clearSession: true }) } catch {}
        }
        await deleteBotById(req.params.id)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/admin/bots/:id/status', authMiddleware, loadAccount, requireAdmin, async (req, res) => {
    try {
        const db = await getMongoDb()
        const bot = await db.collection(COLLECTIONS.BOTS).findOne({ _id: new ObjectId(req.params.id) })
        if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' })
        const action = req.body?.action
        if (action === 'stop') {
            await botManager.stopBot(bot.sessionId, { clearSession: !!req.body.clearSession })
        } else if (action === 'start') {
            await botManager.startBot(bot.sessionId, bot, {})
        }
        res.json({ ok: true, state: botManager.getState(bot.sessionId) })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})


export default router
