import { getMongoDb } from './mongo.js'

// Satu tempat rujukan nama collection, biar dashboard (kode terpisah) dan bot engine
// ini selalu ngerujuk ke nama yang sama.
export const COLLECTIONS = {
    ACCOUNTS: 'accounts',       // login dashboard (email/password / Google OAuth)
    BOTS: 'bots',               // satu dokumen = satu bot milik satu account (ownerId)
    BOT_SETTINGS: 'bot_settings', // pengaturan umum bot (mode, prefix, dst) per botId
    FEATURE_SETTINGS: 'feature_settings', // on/off + custom response/command + access rule, per botId+featureKey
    SUBSCRIPTIONS: 'subscriptions', // status Free/Premium per botId
    ORDERS: 'orders',           // riwayat order/pembayaran SociaBuzz
    BOT_DATA: 'bot_data',       // blob users/chats/contacts per botId (data runtime bot, bukan akun dashboard)
    WA_AUTH: 'wa_auth',          // creds + signal keys Baileys per sessionId (lihat mongoAuthState.js)
    PLATFORM_SETTINGS: 'platform_settings',
    EMAIL_TOKENS: 'email_tokens', // kode OTP
}

// Bikin satu index dengan aman: kalau namanya udah kepake sama spesifikasi lain
// (mismatch, misal sparse/unique beda dari versi kode sebelumnya), Mongo nolak
// bikin index baru itu (IndexOptionsConflict / IndexKeySpecsConflict). Daripada
// bikin ensureIndexes() berhenti total di tengah jalan (index-index sesudahnya
// jadi gak pernah kebuat), kita drop index lama itu terus bikin ulang sesuai spek
// yang dipakai kode sekarang.
async function safeCreateIndex(collection, spec, options = {}) {
    try {
        await collection.createIndex(spec, options)
    } catch (e) {
        const isNameConflict = e.code === 85 || e.code === 86 || /existing index/i.test(e.message || '')
        if (!isNameConflict) {
            console.error(`[db] Gagal membuat index ${collection.collectionName}${JSON.stringify(spec)}:`, e.message)
            return
        }
        try {
            const name = options.name || Object.entries(spec).map(([k, v]) => `${k}_${v}`).join('_')
            await collection.dropIndex(name)
            await collection.createIndex(spec, options)
            console.log(`[db] Index ${collection.collectionName}.${name} diperbaiki (spek lama beda, sudah di-drop & dibuat ulang).`)
        } catch (e2) {
            console.error(`[db] Gagal memperbaiki index ${collection.collectionName}${JSON.stringify(spec)}:`, e2.message)
        }
    }
}

// Index yang WAJIB ada supaya query "bot milik user ini doang" cepat dan konsisten,
// serta mencegah data bocor antar user (isolasi per-owner ditegakkan di query, bukan cuma di UI).
export async function ensureIndexes() {
    const db = await getMongoDb()

    await safeCreateIndex(db.collection(COLLECTIONS.ACCOUNTS), { email: 1 }, { unique: true, sparse: true })
    await safeCreateIndex(db.collection(COLLECTIONS.ACCOUNTS), { googleId: 1 }, { unique: true, sparse: true })

    await safeCreateIndex(db.collection(COLLECTIONS.BOTS), { ownerId: 1 })
    await safeCreateIndex(db.collection(COLLECTIONS.BOTS), { sessionId: 1 }, { unique: true })

    await safeCreateIndex(db.collection(COLLECTIONS.BOT_SETTINGS), { botId: 1 }, { unique: true })
    await safeCreateIndex(db.collection(COLLECTIONS.FEATURE_SETTINGS), { botId: 1, featureKey: 1 }, { unique: true })
    await safeCreateIndex(db.collection(COLLECTIONS.SUBSCRIPTIONS), { botId: 1 }, { unique: true, sparse: true })
    await safeCreateIndex(db.collection(COLLECTIONS.SUBSCRIPTIONS), { accountId: 1 }, { unique: true, sparse: true })
    await safeCreateIndex(db.collection(COLLECTIONS.PLATFORM_SETTINGS), { key: 1 }, { unique: true })

    await safeCreateIndex(db.collection(COLLECTIONS.ORDERS), { accountId: 1 })
    await safeCreateIndex(db.collection(COLLECTIONS.ORDERS), { orderId: 1 }, { unique: true })

    await safeCreateIndex(db.collection(COLLECTIONS.BOT_DATA), { botId: 1 }, { unique: true })

    // WA auth keys sering di-query by prefix sessionId:key — index _id sudah default,
    // tapi status+enabled dipakai resumeAll
    await safeCreateIndex(db.collection(COLLECTIONS.BOTS), { status: 1, enabled: 1 })

    // TTL: dokumen OTP otomatis kehapus begitu expiresAt lewat, jadi kode kadaluarsa gak numpuk
    await safeCreateIndex(db.collection(COLLECTIONS.EMAIL_TOKENS), { expiresAt: 1 }, { expireAfterSeconds: 0 })
    await safeCreateIndex(db.collection(COLLECTIONS.EMAIL_TOKENS), { email: 1, type: 1 })

    try {
        await safeCreateIndex(db.collection(COLLECTIONS.SHARED_FEATURES || 'shared_features'), { featureKey: 1 }, { unique: true })
        await safeCreateIndex(db.collection(COLLECTIONS.SHARED_FEATURES || 'shared_features'), { active: 1, category: 1 })
    } catch {}
    console.log('[db] Index MongoDB siap.')
}
