/**
 * Free-user auto ads: max 3x/hari ke semua grup bot (jika admin aktifkan).
 * Premium tidak dikirimi ads otomatis.
 */
import chalk from 'chalk'
import { getPlatformSettings } from './platformSettings.js'
import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'
import { isAccountPremium } from './db/subscription.js'
import botManager from './botManager.js'

const INTERVAL_MS = 30 * 60 * 1000 // cek tiap 30 menit
let timer = null

function dayKey(d = new Date()) {
    return d.toISOString().slice(0, 10)
}

async function getAdsState(sessionId) {
    const db = await getMongoDb()
    const doc = await db.collection(COLLECTIONS.BOT_SETTINGS).findOne({ botId: sessionId })
    return doc || {}
}

async function setAdsState(sessionId, patch) {
    const db = await getMongoDb()
    await db.collection(COLLECTIONS.BOT_SETTINGS).updateOne(
        { botId: sessionId },
        { $set: { ...patch, botId: sessionId, updatedAt: new Date() } },
        { upsert: true }
    )
}

async function sendAdsForBot(inst, text) {
    const sock = inst.sock
    if (!sock || inst.status !== 'connected') return 0
    let groups = {}
    try {
        groups = await sock.groupFetchAllParticipating()
    } catch (e) {
        console.error(chalk.yellowBright(`[ads] fetch groups ${inst.sessionId}:`), e.message)
        return 0
    }
    const jids = Object.keys(groups || {})
    let sent = 0
    for (const jid of jids) {
        try {
            await sock.sendMessage(jid, { text })
            sent++
            // jeda sangat kecil agar tidak ban, tapi tetap cepat
            await new Promise(r => setTimeout(r, 400))
        } catch {}
    }
    return sent
}

async function tick() {
    try {
        const settings = await getPlatformSettings()
        if (!settings.freeAdsEnabled) return

        const db = await getMongoDb()
        const bots = await db.collection(COLLECTIONS.BOTS).find({
            status: 'connected',
            enabled: { $ne: false }
        }).toArray()

        const perDay = settings.adsPerDay || 3
        // Interval antar kirim ≈ 24h / perDay
        const minGapMs = (24 * 60 * 60 * 1000) / perDay

        for (const bot of bots) {
            try {
                const ownerId = bot.ownerId?.toString?.() || String(bot.ownerId)
                if (await isAccountPremium(ownerId)) continue

                const inst = botManager.get(bot.sessionId)
                if (!inst || inst.status !== 'connected' || !inst.sock) continue

                const st = await getAdsState(bot.sessionId)
                const today = dayKey()
                let count = st.adsDay === today ? (st.adsCount || 0) : 0
                if (count >= perDay) continue

                const last = st.adsLastAt ? new Date(st.adsLastAt).getTime() : 0
                if (last && Date.now() - last < minGapMs) continue

                const n = await sendAdsForBot(inst, settings.adsText)
                await setAdsState(bot.sessionId, {
                    adsDay: today,
                    adsCount: count + 1,
                    adsLastAt: new Date()
                })
                console.log(chalk.cyanBright(`[ads] ${bot.sessionId}: sent to ${n} groups (${count + 1}/${perDay})`))
            } catch (e) {
                console.error(chalk.redBright('[ads] bot error:'), e.message)
            }
        }
    } catch (e) {
        console.error(chalk.redBright('[ads] tick:'), e.message)
    }
}

/**
 * Kirim ads manual (dipicu admin dari dashboard), lepas dari jadwal otomatis.
 * target: 'all' (semua bot connected) atau sessionId bot tertentu.
 * Tidak mengubah adsCount/adsLastAt, jadi tidak mengganggu kuota auto ads.
 */
export async function sendAdsManually({ target, text, skipPremium }) {
    const db = await getMongoDb()
    const query = { status: 'connected', enabled: { $ne: false } }
    if (target && target !== 'all') query.sessionId = target

    const bots = await db.collection(COLLECTIONS.BOTS).find(query).toArray()
    if (!bots.length) return []

    const body = (text || '').trim()
    const results = []

    for (const bot of bots) {
        try {
            if (skipPremium) {
                const ownerId = bot.ownerId?.toString?.() || String(bot.ownerId)
                if (await isAccountPremium(ownerId)) {
                    results.push({ sessionId: bot.sessionId, botName: bot.botName, sent: 0, skipped: 'premium' })
                    continue
                }
            }

            const inst = botManager.get(bot.sessionId)
            if (!inst || inst.status !== 'connected' || !inst.sock) {
                results.push({ sessionId: bot.sessionId, botName: bot.botName, sent: 0, error: 'Bot tidak terhubung' })
                continue
            }

            const n = await sendAdsForBot(inst, body)
            results.push({ sessionId: bot.sessionId, botName: bot.botName, sent: n })
            console.log(chalk.cyanBright(`[ads] manual ${bot.sessionId}: sent to ${n} groups`))
        } catch (e) {
            results.push({ sessionId: bot.sessionId, botName: bot.botName, sent: 0, error: e.message })
        }
    }

    return results
}

export function startAdsScheduler() {
    if (timer) return
    // delay awal 2 menit biar bot sempat connect
    setTimeout(() => {
        tick()
        timer = setInterval(tick, INTERVAL_MS)
    }, 2 * 60 * 1000)
    console.log(chalk.cyanBright('[ads] Scheduler aktif (free bots, max 3x/hari)'))
}
