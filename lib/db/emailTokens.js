import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'
import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

const OTP_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5

function docId(email, type) {
    return `${type}:${email}`
}

function genCode() {
    return String(randomInt(100000, 1000000))
}

/** Bikin OTP baru. payload opsional (disimpan di dokumen, dipakai register pending). */
export async function issueOtp(email, type, payload = null) {
    const db = await getMongoDb()
    const _id = docId(email, type)
    const code = genCode()
    const codeHash = await bcrypt.hash(code, 10)
    const now = new Date()
    const set = {
        _id, email, type, codeHash,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attempts: 0,
        createdAt: now
    }
    if (payload && typeof payload === 'object') set.payload = payload
    else set.payload = null
    try {
        await db.collection(COLLECTIONS.EMAIL_TOKENS).findOneAndUpdate(
            {
                _id,
                $or: [
                    { createdAt: { $lte: new Date(now.getTime() - RESEND_COOLDOWN_MS) } },
                    { createdAt: { $exists: false } }
                ]
            },
            { $set: set },
            { upsert: true, returnDocument: 'before' }
        )
    } catch (e) {
        // A concurrent request may win the upsert and leave a fresh token.
        if (e?.code === 11000) throw new Error('Tunggu sebentar sebelum minta kode baru')
        throw e
    }
    return code
}

/**
 * Cocokkan kode. Return payload dokumen (jika ada) lalu hapus OTP.
 */
export async function verifyOtp(email, type, code) {
    const db = await getMongoDb()
    const _id = docId(email, type)
    const col = db.collection(COLLECTIONS.EMAIL_TOKENS)
    const doc = await col.findOne({ _id })
    if (!doc) throw new Error('Kode tidak ditemukan atau sudah kadaluarsa, minta kode baru')
    if (doc.expiresAt < new Date()) {
        await col.deleteOne({ _id })
        throw new Error('Kode sudah kadaluarsa, minta kode baru')
    }
    if (doc.attempts >= MAX_ATTEMPTS) {
        await col.deleteOne({ _id })
        throw new Error('Terlalu banyak percobaan salah, minta kode baru')
    }
    const ok = await bcrypt.compare(String(code || ''), doc.codeHash)
    if (!ok) {
        await col.updateOne({ _id, attempts: { $lt: MAX_ATTEMPTS } }, { $inc: { attempts: 1 } })
        throw new Error('Kode salah')
    }
    // Claim atomically after bcrypt verification so two simultaneous requests
    // cannot both consume the same valid OTP.
    const claimed = await col.findOneAndDelete({
        _id,
        codeHash: doc.codeHash,
        attempts: { $lt: MAX_ATTEMPTS },
        expiresAt: { $gt: new Date() }
    })
    if (!claimed) throw new Error('Kode sudah digunakan atau kadaluarsa, minta kode baru')
    return claimed.payload || null
}
