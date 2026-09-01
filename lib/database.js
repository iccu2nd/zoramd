import { updateStreak, checkBrokenStreaks as checkBrokenStreaks_ } from './streak.js'
import { bindRpgCurrency } from './rpg.js'
import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'
import config from '../config.js'

const botId = config.botId || 'default'
const FLUSH_INTERVAL_MS = 30000

const defaultSettings = {
    mode: 'public',
    noprefix: false,
    autoread: false,
    autotyping: false,
    errorReport: true,
    scheduledLeaves: {},
    extraOwners: [],
    blockedCmds: [],

    gconly: false,
    gconlyPremiumBypass: false,
    sapaList: {}
}

// Data runtime (users/chats/contacts/lid_mapping/msgs) dan pengaturan bot disimpan di 2 collection
// terpisah supaya dashboard bisa baca/ubah "Bot Settings" tanpa perlu narik seluruh blob data user
// yang jauh lebih besar. Keduanya dimuat sekali ke memori saat start, lalu di-flush berkala
// (bukan tiap perubahan) supaya gak boros write ke MongoDB -- konsisten sama pola lama yang
// nulis ke db.json tiap 30 detik, cuma sekarang targetnya Mongo.
const mongo = await getMongoDb()
const botDataCol = mongo.collection(COLLECTIONS.BOT_DATA)
const botSettingsCol = mongo.collection(COLLECTIONS.BOT_SETTINGS)

const [dataDoc, settingsDoc] = await Promise.all([
    botDataCol.findOne({ botId }),
    botSettingsCol.findOne({ botId })
])

global.db = {
    data: {
        users: dataDoc?.users || {},
        chats: dataDoc?.chats || {},
        contacts: dataDoc?.contacts || {},
        lid_mapping: dataDoc?.lid_mapping || {},
        msgs: dataDoc?.msgs || {}
    }
}

const gd = global.db.data
export const settings = { ...defaultSettings, ...(settingsDoc || {}) }
delete settings._id
delete settings.botId

for (const jid of Object.keys(gd.users)) {
    if (gd.users[jid]?.rpg) bindRpgCurrency(jid)
}

setInterval(async () => {
    try {
        await Promise.all([
            botDataCol.updateOne(
                { botId },
                { $set: { botId, ...gd, updatedAt: new Date() } },
                { upsert: true }
            ),
            botSettingsCol.updateOne(
                { botId },
                { $set: { botId, ...settings, updatedAt: new Date() } },
                { upsert: true }
            )
        ])
    } catch (e) {
        console.error('Gagal menyimpan database ke MongoDB:', e.message)
    }
}, FLUSH_INTERVAL_MS)

export default function loadUser(m) {
    let streakUpdated = false

    if (m.sender?.endsWith('@s.whatsapp.net') || m.sender?.endsWith('@lid')) {
        const user = gd.users[m.sender] ??= {}
        user.name = m.pushName || m.sender.split('@')[0] || user.name
        user.afk ??= -1
        user.afkReason ??= ''
        user.afkName ??= ''
        user.money ??= 0
        user.bank ??= 0
        user.banned ??= false
        user.warn ??= 0
        user.premium ??= false
        user.premiumTime ??= 0
        user.registered ??= false
        user.regStep ??= ''
        user.regName ??= ''
        user.lastclaim ??= 0
        user.streak ??= 0
        user.lastStreakDate ??= ''
        user.streakNotif ??= true
        user.lastSapa ??= 0

        streakUpdated = updateStreak(user).updated
    }

    if (m.isGroup && m.from) {
        const chat = gd.chats[m.from] ??= {}
        chat.welcome ??= true
        chat.welcomeText ??= 'Hai @pushname, Selamat datang di @gcname!'
        chat.goodbye ??= true
        chat.goodbyeText ??= 'Selamat tinggal @pushname, semoga tenang disana.'
        chat.antiLink ??= false
        chat.antilottie ??= false
        chat.antiSpam ??= false
        chat.antiSpamLimit ??= 8
        chat.worldEvent ??= true
        chat.blacklist ??= []
        chat.isBanned ??= false
        chat.rpgOff ??= false
        chat.owoBoost ??= 1
        chat.owoBoostExpiry ??= 0
    }

    return {
        streakUpdated,
        streak: gd.users[m.sender]?.streak
    }
}

export function checkBrokenStreaks() {
    return checkBrokenStreaks_(gd.users)
}

export function saveContact(jid, lid, pushName) {
    if (!jid || !jid.endsWith('@s.whatsapp.net')) return
    const existing = gd.contacts[jid]
    let finalName = pushName
    if (pushName === 'Unknown' || !pushName) {
        finalName = (existing?.pushname && existing.pushname !== 'null') ? existing.pushname : 'null'
    }
    const finalLid = lid || existing?.lid || 'null'
    if (!existing || existing.pushname !== finalName || existing.lid !== finalLid) {
        gd.contacts[jid] = { jid, lid: finalLid, pushname: finalName }
    }
    if (lid?.endsWith('@lid')) gd.lid_mapping[lid] = jid
}

export function getContact(jid) {
    return gd.contacts[jid]
}

export function getChatData(jid) {
    gd.chats[jid] ??= {}
    return gd.chats[jid]
}

export function getLidMapping(lid) {
    return gd.lid_mapping[lid] || null
}

export function saveMetadata(jid, name, desc, participants = []) {
    if (!jid || (!jid.endsWith('@g.us') && !jid.endsWith('@newsletter'))) return
    gd.chats[jid] ??= {}
    gd.chats[jid].jid = jid
    gd.chats[jid].name = name || 'null'
    gd.chats[jid].description = desc || 'null'
    gd.chats[jid].members = JSON.stringify(participants)
}

export function syncGroupParticipants(jid, participants = []) {
    if (!jid || !participants.length) return
    for (const p of participants) {
        const userJid = p.phoneNumber || (p.id?.endsWith('@s.whatsapp.net') ? p.id : null)
        const userLid = p.id?.endsWith('@lid') ? p.id : null
        if (userJid) saveContact(userJid, userLid, 'Unknown')
    }
}

export async function getGroupSettings(jid) {
    const c = gd.chats[jid] || {}
    return {
        welcome: c.welcome !== false,
        goodbye: c.goodbye !== false,
        welcomeText: c.welcomeText || 'Hai @pushname, Selamat datang di @gcname!',
        goodbyeText: c.goodbyeText || 'Selamat tinggal @pushname, semoga tenang disana.',
    }
}
