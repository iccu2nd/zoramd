import bcrypt from 'bcryptjs'
import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

const OTP_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5

function docId(email, type) {
    return `${type}:${email}`
}

function genCode() {
    return String(Math.floor(100000 + Math.random() * 900000))
}

/** Bikin OTP baru. payload opsional (disimpan di dokumen, dipakai register pending). */
export async function issueOtp(email, type, payload = null) {
    const db = await getMongoDb()
    const _id = docId(email, type)
    const existing = await db.collection(COLLECTIONS.EMAIL_TOKENS).findOne({ _id })
    if (existing?.createdAt && Date.now() - existing.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        throw new Error('Tunggu sebentar sebelum minta kode baru')
    }
    const code = genCode()
    const codeHash = await bcrypt.hash(code, 10)
    const set = {
        _id, email, type, codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
        createdAt: new Date()
    }
    if (payload && typeof payload === 'object') set.payload = payload
    else set.payload = null
    await db.collection(COLLECTIONS.EMAIL_TOKENS).updateOne(
        { _id },
        { $set: set },
        { upsert: true }
    )
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
        await col.updateOne({ _id }, { $inc: { attempts: 1 } })
        throw new Error('Kode salah')
    }
    const payload = doc.payload || null
    await col.deleteOne({ _id })
    return payload
}
