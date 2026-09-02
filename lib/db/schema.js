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
    PLATFORM_SETTINGS: 'platform_settings'
}

// Index yang WAJIB ada supaya query "bot milik user ini doang" cepat dan konsisten,
// serta mencegah data bocor antar user (isolasi per-owner ditegakkan di query, bukan cuma di UI).
export async function ensureIndexes() {
    const db = await getMongoDb()

    await db.collection(COLLECTIONS.ACCOUNTS).createIndex({ email: 1 }, { unique: true, sparse: true })
    await db.collection(COLLECTIONS.ACCOUNTS).createIndex({ googleId: 1 }, { unique: true, sparse: true })

    await db.collection(COLLECTIONS.BOTS).createIndex({ ownerId: 1 })
    await db.collection(COLLECTIONS.BOTS).createIndex({ sessionId: 1 }, { unique: true })

    await db.collection(COLLECTIONS.BOT_SETTINGS).createIndex({ botId: 1 }, { unique: true })
    await db.collection(COLLECTIONS.FEATURE_SETTINGS).createIndex({ botId: 1, featureKey: 1 }, { unique: true })
    await db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndex({ botId: 1 }, { unique: true, sparse: true })
    await db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndex({ accountId: 1 }, { unique: true, sparse: true })
    await db.collection(COLLECTIONS.PLATFORM_SETTINGS).createIndex({ key: 1 }, { unique: true })

    await db.collection(COLLECTIONS.ORDERS).createIndex({ accountId: 1 })
    await db.collection(COLLECTIONS.ORDERS).createIndex({ orderId: 1 }, { unique: true })

    await db.collection(COLLECTIONS.BOT_DATA).createIndex({ botId: 1 }, { unique: true })

    console.log('[db] Index MongoDB siap.')
}
