export default {
    cmd: ['delprem'],
    category: 'owner',
    run: async (m, { sock }) => {
        const rawTarget = m.mentionedJid?.[0] || m.quoted?.sender
        if (!rawTarget) {
            return m.reply('Tag atau reply user.\nContoh: .delprem @user\natau reply pesan lalu: .delprem')
        }

        let target = rawTarget
        if (target.endsWith('@lid')) {
            const mapped = global.db.data.lid_mapping?.[target]
            if (mapped) target = mapped
        }
        if (target.endsWith('@s.whatsapp.net')) {
            target = target.replace(/:\d+@/, '@')
        }

        let user = global.db.data.users[target]
        if (!user && rawTarget !== target) user = global.db.data.users[rawTarget]
        if (!user) return m.reply('User tidak ditemukan di database.')

        if (!user.premium && !(user.premiumTime > Date.now())) {
            return m.reply('User tersebut bukan member premium.')
        }

        user.premium = false
        user.premiumTime = 0
        if (rawTarget !== target && global.db.data.users[rawTarget]) {
            global.db.data.users[rawTarget].premium = false
            global.db.data.users[rawTarget].premiumTime = 0
        }

        await sock.sendMessage(m.from, {
            text: `Status premium @${target.split('@')[0]} telah dihapus.`,
            mentions: [target.endsWith('@s.whatsapp.net') ? target : rawTarget]
        }, { quoted: m })
    }
}
