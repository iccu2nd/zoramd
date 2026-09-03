import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { findAccountByEmail, findAccountById, createAccount, updateAccount } from '../lib/db/accounts.js'
import { issueOtp, verifyOtp } from '../lib/db/emailTokens.js'
import { sendVerificationOtp, sendPasswordResetOtp } from '../lib/email.js'
import { assertJwtSecret } from '../lib/security.js'

assertJwtSecret()

const JWT_SECRET = process.env.JWT_SECRET || 'zorabot-dev-secret-change-me'
const TOKEN_TTL = '7d'

export function signToken(account) {
    return jwt.sign(
        { sub: account._id.toString(), email: account.email, name: account.name },
        JWT_SECRET,
        { expiresIn: TOKEN_TTL }
    )
}

export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET)
    } catch {
        return null
    }
}

/** Step 1: validasi + kirim OTP. Akun belum dibuat. */
export async function startRegister({ email, password, name }) {
    email = (email || '').trim().toLowerCase()
    name = (name || '').trim()
    if (!email || !password || password.length < 6) {
        throw new Error('Email dan password (min 6 karakter) wajib diisi')
    }
    if (!name) throw new Error('Nama wajib diisi')
    const existing = await findAccountByEmail(email)
    if (existing) throw new Error('Email sudah terdaftar')
    const passwordHash = await bcrypt.hash(password, 10)
    const code = await issueOtp(email, 'register', {
        passwordHash,
        name: name || email.split('@')[0]
    })
    await sendVerificationOtp(email, code)
    return { email, pending: true }
}

/** Step 2: verifikasi OTP 6 digit → buat akun (emailVerified = true) + token */
export async function completeRegister({ email, code }) {
    email = (email || '').trim().toLowerCase()
    if (!email || !code) throw new Error('Email dan kode OTP wajib diisi')
    const existing = await findAccountByEmail(email)
    if (existing) throw new Error('Email sudah terdaftar')
    const payload = await verifyOtp(email, 'register', code)
    if (!payload?.passwordHash) throw new Error('Sesi registrasi tidak valid, daftar ulang')
    const account = await createAccount({
        email,
        passwordHash: payload.passwordHash,
        name: payload.name || email.split('@')[0]
    })
    await updateAccount(account._id, { emailVerified: true })
    account.emailVerified = true
    return { account, token: signToken(account) }
}

/** Legacy: tetap ada jika dipanggil, tapi alur utama pakai start+complete */
export async function register({ email, password, name }) {
    await startRegister({ email, password, name })
    throw new Error('OTP telah dikirim. Masukkan kode 6 digit untuk menyelesaikan daftar.')
}

export async function login({ email, password }) {
    email = (email || '').trim().toLowerCase()
    const account = await findAccountByEmail(email)
    if (!account || !account.passwordHash) throw new Error('Email atau password salah')
    const ok = await bcrypt.compare(password, account.passwordHash)
    if (!ok) throw new Error('Email atau password salah')
    return { account, token: signToken(account) }
}

export function authMiddleware(req, res, next) {
    const header = req.headers.authorization || ''
    const cookieToken = req.cookies?.token
    const token = header.startsWith('Bearer ') ? header.slice(7) : cookieToken
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' })
    }
    const payload = verifyToken(token)
    if (!payload) {
        return res.status(401).json({ error: 'Token tidak valid atau kadaluarsa' })
    }
    req.user = payload
    next()
}

// ---------- Verifikasi email ----------

export async function requestEmailVerification(email) {
    email = (email || '').trim().toLowerCase()
    if (!email) throw new Error('Email wajib diisi')
    const code = await issueOtp(email, 'verify')
    await sendVerificationOtp(email, code)
}

export async function confirmEmailVerification(email, code) {
    email = (email || '').trim().toLowerCase()
    if (!code) throw new Error('Kode wajib diisi')
    await verifyOtp(email, 'verify', code)
    const account = await findAccountByEmail(email)
    if (!account) throw new Error('Akun tidak ditemukan')
    await updateAccount(account._id, { emailVerified: true })
}

// ---------- Reset password ----------

export async function requestPasswordReset(email) {
    email = (email || '').trim().toLowerCase()
    if (!email) throw new Error('Email wajib diisi')
    const account = await findAccountByEmail(email)
    // Jangan bocorin apakah email terdaftar atau tidak -- diam-diam skip kalau gak ada.
    if (!account) return
    const code = await issueOtp(email, 'reset')
    await sendPasswordResetOtp(email, code)
}

export async function resetPassword({ email, code, newPassword }) {
    email = (email || '').trim().toLowerCase()
    if (!newPassword || newPassword.length < 6) {
        throw new Error('Password baru minimal 6 karakter')
    }
    await verifyOtp(email, 'reset', code)
    const account = await findAccountByEmail(email)
    if (!account) throw new Error('Akun tidak ditemukan')
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await updateAccount(account._id, { passwordHash })
}

export async function loadAccount(req, res, next) {
    try {
        const account = await findAccountById(req.user.sub)
        if (!account) return res.status(401).json({ error: 'Akun tidak ditemukan' })
        req.account = account
        next()
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
}
