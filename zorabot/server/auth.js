import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { findAccountByEmail, findAccountById, createAccount } from '../lib/db/accounts.js'

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

export async function register({ email, password, name }) {
    email = (email || '').trim().toLowerCase()
    if (!email || !password || password.length < 6) {
        throw new Error('Email dan password (min 6 karakter) wajib diisi')
    }
    const existing = await findAccountByEmail(email)
    if (existing) throw new Error('Email sudah terdaftar')
    const passwordHash = await bcrypt.hash(password, 10)
    const account = await createAccount({ email, passwordHash, name: name || email.split('@')[0] })
    return { account, token: signToken(account) }
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
