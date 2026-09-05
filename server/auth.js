import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { findAccountByEmail, findAccountByGoogleId, findAccountById, createAccount, updateAccount } from '../lib/db/accounts.js'
import { issueOtp, verifyOtp } from '../lib/db/emailTokens.js'
import { sendVerificationOtp, sendPasswordResetOtp } from '../lib/email.js'
import { assertJwtSecret, publicError } from '../lib/security.js'

assertJwtSecret()

const JWT_SECRET = process.env.JWT_SECRET || 'zorabot-dev-secret-change-me'
const TOKEN_TTL = '7d'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || ''
let googleClient = null

export function isGoogleSignInEnabled() {
    return !!GOOGLE_CLIENT_ID
}

function getGoogleClient() {
    if (!GOOGLE_CLIENT_ID) return null
    googleClient ||= new OAuth2Client(GOOGLE_CLIENT_ID)
    return googleClient
}

export function signToken(account) {
    return jwt.sign(
        { sub: account._id.toString(), email: account.email, name: account.name },
        JWT_SECRET,
        { expiresIn: TOKEN_TTL }
    )
}

export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET, { clockTolerance: 60 })
    } catch {
        return null
    }
}

export function readAuthToken(req) {
    const header = req.headers.authorization || ''
    if (header.startsWith('Bearer ') && header.length > 7) {
        return header.slice(7).trim()
    }
    return req.cookies?.zora_sid || req.cookies?.token || null
}

export function isAdminAccount(account) {
    if (!account) return false
    if (account.role === 'admin') return true
    const allow = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
    return !!account.email && allow.includes(String(account.email).toLowerCase())
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

/**
 * Verifies the Google Identity Services ID token on the server, then maps the
 * Google subject to the existing account model. The Google subject is the
 * stable provider identifier; the email is only used to safely link an
 * existing email/password account once.
 */
export async function loginWithGoogle(credential, { termsAccepted = false } = {}) {
    if (!isGoogleSignInEnabled()) {
        throw new Error('Google Sign-In belum dikonfigurasi')
    }
    if (typeof credential !== 'string' || credential.length < 100 || credential.length > 10000) {
        throw new Error('Token Google tidak valid')
    }

    const client = getGoogleClient()
    let ticket
    try {
        ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        })
    } catch {
        throw new Error('Token Google tidak valid atau sudah kedaluwarsa')
    }

    const payload = ticket.getPayload()
    const validIssuer = payload?.iss === 'accounts.google.com' || payload?.iss === 'https://accounts.google.com'
    if (!payload?.sub || !validIssuer || payload.aud !== GOOGLE_CLIENT_ID || payload.email_verified !== true) {
        throw new Error('Akun Google belum terverifikasi')
    }

    const googleId = String(payload.sub)
    const email = String(payload.email || '').trim().toLowerCase()
    if (!email || !email.includes('@')) throw new Error('Email Google tidak tersedia')
    const name = String(payload.name || payload.given_name || email.split('@')[0]).trim().slice(0, 120)

    // Prefer the immutable Google subject, then link by normalized email so an
    // email/password user does not receive a second account.
    let account = await findAccountByGoogleId(googleId)
    if (!account) {
        account = await findAccountByEmail(email)
        if (account) {
            if (account.googleId && account.googleId !== googleId) {
                throw new Error('Email Google sudah tertaut ke akun lain')
            }
            const patch = { googleId, emailVerified: true }
            if (!account.name) patch.name = name
            await updateAccount(account._id, patch)
            account = { ...account, ...patch }
        } else {
            if (!termsAccepted) {
                throw new Error('Setujui Terms of Service dan Privacy Policy sebelum membuat akun')
            }
            try {
                account = await createAccount({
                    email,
                    googleId,
                    name
                })
                await updateAccount(account._id, { emailVerified: true })
                account.emailVerified = true
            } catch (error) {
                // A concurrent first login may have won either unique index.
                // Re-read instead of creating a duplicate or returning a
                // database error to the browser.
                if (error?.code !== 11000) throw error
                account = await findAccountByGoogleId(googleId)
                    || await findAccountByEmail(email)
                if (!account) throw error
            }
        }
    }

    return { account, token: signToken(account) }
}

export function authMiddleware(req, res, next) {
    const token = readAuthToken(req)
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
        res.status(500).json({ error: publicError(e, 'Sesi tidak dapat diverifikasi') })
    }
}
