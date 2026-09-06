import { getRpg, hasStarted, applyGodmode } from '../lib/rpg.js'
import { getOwo, fmtCowoncy, applyOwoGodmode } from '../lib/owo.js'

function resolveTarget(m) {
    let raw = m.mentionedJid?.[0] || m.quoted?.sender || null
    if (!raw) raw = m.sender
    let target = raw
    if (target.endsWith('@lid')) {
        const mapped = global.db.data.lid_mapping?.[target]
        if (mapped) target = mapped
    }
    if (target.endsWith('@s.whatsapp.net')) {
        target = target.replace(/:\d+@/, '@')
    }
    return target
}

function ensureUser(jid) {
    const users = global.db.data.users
    users[jid] ??= {
        name: jid.split('@')[0],
        money: 0,
        bank: 0,
        banned: false,
        warn: 0,
        premium: false,
        premiumTime: 0,
        registered: false,
        streak: 0,
        lastStreakDate: '',
        streakNotif: true
    }
    return users[jid]
}

function todayJakarta() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

export default {
    cmd: ['cheat'],
    category: 'owner',
    run: async (m, { sock, text, prefix, cmd }) => {
        if (!m.isOwner) {
            return m.reply('Khusus Owner.')
        }

        const args = text.trim().split(/ +/).filter(Boolean)
        const mode = (args[0] || '').toLowerCase()

        if (!mode || mode === 'help') {
            return m.reply(
`*CHEAT (OWNER ONLY)*

Owner punya kuasa penuh atas data di database.

${prefix + cmd} all
  → Godmode RPG + OWO + money (diri sendiri)

${prefix + cmd} streak <jumlah> [@user]
  → Set streak hari (default: diri sendiri)
  Contoh: ${prefix + cmd} streak 30
  Contoh: ${prefix + cmd} streak 100 @user

${prefix + cmd} streak reset [@user]
  → Reset streak ke 0

${prefix + cmd} money <jumlah> [@user]
  → Set / tambah money (pakai +angka untuk tambah)
  Contoh: ${prefix + cmd} money 999999
  Contoh: ${prefix + cmd} money +50000 @user

${prefix + cmd} bank <jumlah> [@user]
  → Set bank

${prefix + cmd} owo <jumlah>
  → Tambah OWO cowoncy

${prefix + cmd} prem <hari> [@user]
  → Set user premium N hari (0 = cabut)
  Contoh: ${prefix + cmd} prem 30 @user

${prefix + cmd} reg [@user]
  → Paksa verifikasi / register user

${prefix + cmd} unreg [@user]
  → Cabut verifikasi

${prefix + cmd} ban [@user]
  → Ban user

${prefix + cmd} unban [@user]
  → Unban user

${prefix + cmd} warn <jumlah> [@user]
  → Set warn count

${prefix + cmd} get [@user]
  → Lihat data user di database

Semua aksi bisa ke diri sendiri atau tag/reply user target.`
            )
        }

        const target = resolveTarget(m)
        const user = ensureUser(target)
        const tag = `@${target.split('@')[0]}`
        const mentionList = [target]

        if (mode === 'all') {
            const self = m.sender
            if (!hasStarted(self)) {
                return m.reply('Anda belum punya karakter RPG. Ketik .start dulu sebelum menggunakan godmode.')
            }
            const rpg = getRpg(self)
            applyGodmode(rpg)
            const owo = applyOwoGodmode(self)
            const u = ensureUser(self)
            u.money = 999999999
            u.bank = 999999999
            u.streak = Math.max(u.streak || 0, 999)
            u.lastStreakDate = todayJakarta()
            u.premium = true
            u.premiumTime = Date.now() + 365 * 86400000
            u.registered = true

            return sock.sendMessage(m.from, {
                text:
`👑 *GODMODE AKTIF*

Level: ${rpg.level}
ATK: ${rpg.atk}
DEF: ${rpg.def}
Semua gelar, achievement, skill terbuka
Gear / pet / mount terbaik

Money: ${u.money}
Bank: ${u.bank}
Streak: ${u.streak} hari
Premium: 365 hari
OWO Cowoncy: ${fmtCowoncy(owo.cowoncy)}`
            }, { quoted: m })
        }

        if (mode === 'streak') {
            const sub = (args[1] || '').toLowerCase()
            if (sub === 'reset' || sub === '0') {
                user.streak = 0
                user.lastStreakDate = ''
                return sock.sendMessage(m.from, {
                    text: `✅ Streak ${tag} di-reset ke *0*.`,
                    mentions: mentionList
                }, { quoted: m })
            }

            const amount = parseInt(args[1], 10)
            if (!amount || amount < 0) {
                return m.reply(`Masukan jumlah streak.\nContoh: ${prefix + cmd} streak 30\n${prefix + cmd} streak reset`)
            }
            user.streak = amount
            user.lastStreakDate = todayJakarta()
            return sock.sendMessage(m.from, {
                text: `✅ Streak ${tag} diset ke *${amount} hari* 🔥\n(lastStreakDate = hari ini, biar tidak auto-reset)`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'money') {
            const raw = args[1]
            if (raw == null) return m.reply(`Contoh: ${prefix + cmd} money 999999\n${prefix + cmd} money +50000 @user`)
            if (String(raw).startsWith('+')) {
                const add = parseInt(String(raw).slice(1), 10)
                if (!add || add <= 0) return m.reply('Jumlah tidak valid.')
                user.money = (user.money || 0) + add
                return sock.sendMessage(m.from, {
                    text: `✅ Money ${tag}: +${add}\nSekarang: *${user.money}*`,
                    mentions: mentionList
                }, { quoted: m })
            }
            const amount = parseInt(raw, 10)
            if (isNaN(amount) || amount < 0) return m.reply('Jumlah tidak valid.')
            user.money = amount
            return sock.sendMessage(m.from, {
                text: `✅ Money ${tag} diset ke *${amount}*`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'bank') {
            const raw = args[1]
            if (raw == null) return m.reply(`Contoh: ${prefix + cmd} bank 100000`)
            if (String(raw).startsWith('+')) {
                const add = parseInt(String(raw).slice(1), 10)
                if (!add || add <= 0) return m.reply('Jumlah tidak valid.')
                user.bank = (user.bank || 0) + add
                return sock.sendMessage(m.from, {
                    text: `✅ Bank ${tag}: +${add}\nSekarang: *${user.bank}*`,
                    mentions: mentionList
                }, { quoted: m })
            }
            const amount = parseInt(raw, 10)
            if (isNaN(amount) || amount < 0) return m.reply('Jumlah tidak valid.')
            user.bank = amount
            return sock.sendMessage(m.from, {
                text: `✅ Bank ${tag} diset ke *${amount}*`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'owo') {
            const amount = parseInt(args[1], 10)
            if (!amount || amount <= 0) return m.reply(`Contoh: ${prefix + cmd} owo 50000`)
            const owo = getOwo(target)
            owo.cowoncy = (owo.cowoncy || 0) + amount
            return sock.sendMessage(m.from, {
                text: `✅ OWO ${tag}: +${fmtCowoncy(amount)}\nSekarang: *${fmtCowoncy(owo.cowoncy)}*`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'prem' || mode === 'premium') {
            const days = parseInt(args[1], 10)
            if (isNaN(days) || days < 0) {
                return m.reply(`Contoh: ${prefix + cmd} prem 30 @user\n${prefix + cmd} prem 0 @user (cabut)`)
            }
            if (days === 0) {
                user.premium = false
                user.premiumTime = 0
                return sock.sendMessage(m.from, {
                    text: `✅ Premium ${tag} dicabut.`,
                    mentions: mentionList
                }, { quoted: m })
            }
            const base = user.premium && user.premiumTime > Date.now() ? user.premiumTime : Date.now()
            user.premium = true
            user.premiumTime = base + days * 86400000
            const expire = new Date(user.premiumTime).toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
            })
            return sock.sendMessage(m.from, {
                text: `✅ Premium ${tag} aktif *${days} hari* (hingga ${expire})`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'reg' || mode === 'verify') {
            user.registered = true
            user.regName = user.regName || user.name || target.split('@')[0]
            user.regStep = ''
            return sock.sendMessage(m.from, {
                text: `✅ ${tag} dipaksa *terverifikasi*.`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'unreg') {
            user.registered = false
            user.regName = ''
            user.regStep = ''
            return sock.sendMessage(m.from, {
                text: `✅ Verifikasi ${tag} dicabut.`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'ban') {
            user.banned = true
            return sock.sendMessage(m.from, {
                text: `✅ ${tag} di-*ban*.`,
                mentions: mentionList
            }, { quoted: m })
        }
        if (mode === 'unban') {
            user.banned = false
            return sock.sendMessage(m.from, {
                text: `✅ ${tag} di-*unban*.`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'warn') {
            const amount = parseInt(args[1], 10)
            if (isNaN(amount) || amount < 0) return m.reply(`Contoh: ${prefix + cmd} warn 0 @user`)
            user.warn = amount
            return sock.sendMessage(m.from, {
                text: `✅ Warn ${tag} diset ke *${amount}*`,
                mentions: mentionList
            }, { quoted: m })
        }

        if (mode === 'get' || mode === 'info' || mode === 'db') {
            const premActive = typeof user.premiumTime === 'number' && user.premiumTime > Date.now()
            const premExpire = premActive
                ? new Date(user.premiumTime).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
                : '-'
            return sock.sendMessage(m.from, {
                text:
`📂 *DB USER* ${tag}

JID: ${target}
Nama: ${user.name || '-'}
Money: ${user.money || 0}
Bank: ${user.bank || 0}
Streak: ${user.streak || 0} (last: ${user.lastStreakDate || '-'})
Premium: ${premActive ? '✅ ' + premExpire : '❌'}
Registered: ${user.registered ? '✅' : '❌'}
Banned: ${user.banned ? '✅' : '❌'}
Warn: ${user.warn || 0}`,
                mentions: mentionList
            }, { quoted: m })
        }

        return m.reply(`Mode tidak dikenal: *${mode}*\nKetik *${prefix + cmd} help* untuk daftar cheat.`)
    }
}
