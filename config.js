export default {
    // Identitas default (bisa di-override per-bot lewat identity di MongoDB, premium only)
    botId: process.env.BOT_ID || 'default',

    botName: 'ZoraBot',
    author: 'ZoraBot',
    title: '© ZoraBot',
    body: 'powered by ZoraBot',
    packname: 'ZoraBot',
    thumbnail: 'https://u.pone.rs/yougyfln.jpeg',

    readMore: String.fromCharCode(8206).repeat(4001),

    ownerNumber: process.env.OWNER_NUMBER
        ? [process.env.OWNER_NUMBER.replace(/[^0-9]/g, '')]
        : ['6282322962313'],

    sourceUrl: process.env.APP_URL || 'http://localhost:3000',
    idch: '120363424427516649@newsletter',
    groupId: '120363424104004132@g.us',
    groupUrl: 'https://chat.whatsapp.com/JqClorftqjTDnovWSGdpab',
    channelUrl: 'https://whatsapp.com/channel/0029VbC7SGt65yDCUxYwUS3U/949',

    usePairingCode: true,

    generateHighQualityLinkPreview: false,
    consoleLog: true,

    text: {
        didyoumean: (prefix, cmd, suggestions) =>
            `Perintah *${prefix}${cmd}* tidak ditemukan.\n\nMungkin maksud kamu:\n${suggestions.map(s => `- ${prefix}${s}`).join('\n')}`,
        blockedCmd: cmd => `Fitur *${cmd}* sedang dinonaktifkan sementara.`,
        notRegistered: '*Kamu belum terverifikasi di database!*\n\nPencet tombol di bawah buat verifikasi nama WhatsApp kamu.',
        connected: botName => `${botName} Terhubung`
    }
}
