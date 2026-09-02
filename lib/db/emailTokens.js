import bcrypt from 'bcryptjs'
import { getMongoDb } from './mongo.js'
import { COLLECTIONS } from './schema.js'

// Satu dokumen per (email, type) -- minta OTP baru menimpa yang lama.
// type: 'verify' (verifikasi email) | 'reset' (reset password)

const OTP_TTL_MS = 10 * 60 * 1000       // kode berlaku 10 menit
const RESEND_COOLDOWN_MS = 60 * 1000    // jeda minimal antar kirim ulang
const MAX_ATTEMPTS = 5                  // percobaan salah sebelum kode itu dianggap mati

function docId(email, type) {
    return `${type}:${email}`
}

function genCode() {
    return String(Math.floor(100000 + Math.random() * 900000)) // 6 digit
}

/** Bikin OTP baru untuk email+type, simpan hash-nya, return kode plaintext buat dikirim via email. */
export async function issueOtp(email, type) {
    const db = await getMongoDb()
    const _id = docId(email, type)
    const existing = await db.collection(COLLECTIONS.EMAIL_TOKENS).findOne({ _id })
    if (existing?.createdAt && Date.now() - existing.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        throw new Error('Tunggu sebentar sebelum minta kode baru')
    }
    const code = genCode()
    const codeHash = await bcrypt.hash(code, 10)
    await db.collection(COLLECTIONS.EMAIL_TOKENS).updateOne(
        { _id },
        { $set: {
            _id, email, type, codeHash,
            expiresAt: new Date(Date.now() + OTP_TTL_MS),
            attempts: 0,
            createdAt: new Date()
        }},
        { upsert: true }
    )
    return code
}

/** Cocokkan kode yang diinput user. Berhasil = OTP langsung dihapus (sekali pakai). */
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
    await col.deleteOne({ _id })
    return true
}
