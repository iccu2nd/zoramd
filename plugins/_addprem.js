export default {
    cmd: ['addprem'],
    category: 'owner',
    run: async (m, { sock, text }) => {
        const rawTarget = m.mentionedJid?.[0] || m.quoted?.sender
        if (!rawTarget) {
            return m.reply('Tag atau reply user.\nContoh: .addprem @user 7\natau reply pesan lalu: .addprem 7')
        }

        // Resolve LID → phone JID if possible
        let target = rawTarget
        if (target.endsWith('@lid')) {
            const mapped = global.db.data.lid_mapping?.[target]
            if (mapped) target = mapped
        }
        // Normalize phone jid
        if (target.endsWith('@s.whatsapp.net')) {
            target = target.replace(/:\d+@/, '@')
        }

        // Also try alternate keys if still lid
        let user = global.db.data.users[target]
        if (!user && rawTarget !== target) user = global.db.data.users[rawTarget]
        if (!user && m.quoted?.lid) user = global.db.data.users[m.quoted.lid]

        // Auto-create user entry if missing (so owner can prem someone who hasn't chatted)
        if (!user) {
            global.db.data.users[target] = {
                name: target.split('@')[0],
                premium: false,
                premiumTime: 0,
                registered: false,
                banned: false,
                money: 0,
                bank: 0,
                warn: 0
            }
            user = global.db.data.users[target]
        }

        // Parse days: last number in text, or whole text if quoted reply
        const nums = String(text || '').match(/\d+/g)
        const days = nums ? parseInt(nums[nums.length - 1], 10) : NaN
        if (!days || days <= 0) {
            return m.reply('Masukan jumlah hari.\nContoh: .addprem @user 7\natau reply pesan lalu: .addprem 7')
        }

        const base = user.premium && user.premiumTime > Date.now() ? user.premiumTime : Date.now()
        user.premium = true
        user.premiumTime = base + days * 86400000

        // Keep alias keys in sync (lid + phone) so lookups always find premium
        if (rawTarget !== target && global.db.data.users[rawTarget]) {
            global.db.data.users[rawTarget].premium = true
            global.db.data.users[rawTarget].premiumTime = user.premiumTime
        }

        const expire = new Date(user.premiumTime).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'long', year: 'numeric'
        })
        return sock.sendMessage(m.from, {
            text: `Berhasil menambahkan @${target.split('@')[0]} ke daftar premium selama ${days} hari (hingga ${expire})`,
            mentions: [target.endsWith('@s.whatsapp.net') ? target : rawTarget]
        }, { quoted: m })
    }
}
