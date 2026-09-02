
import { createPayment, methodPayment, waitForPayment } from '../lib/sociabuzz.js'

const SOCIABUZZ_USERNAME = 'reyzdesu'

const formatRp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID')

const toDate = (val) => {
    if (val instanceof Date) return val
    const num = Number(val)
    if (!Number.isNaN(num) && String(val).trim() !== '') {
        return new Date(num < 1e12 ? num * 1000 : num)
    }
    return new Date(val)
}

const formatWIB = (val) => {
    const d = toDate(val)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }) + ' WIB'
}

const buildInfoText = (trx) => {
    const pi = trx.payment_info
    const lines = [
        `Metode: ${pi.method.toUpperCase()}`,
        `Nominal: ${formatRp(trx.amount)}`,
        `Total bayar: ${formatRp(trx.total_amount)}` + (trx.fee ? ` (fee ${formatRp(trx.fee)})` : ''),
        `Batas waktu: ${formatWIB(trx.expired_at)}`
    ]

    if (pi.account_number) {
        lines.push('', `Bank: ${pi.bank_name || pi.bank || pi.method.toUpperCase()}`, `No. VA: ${pi.account_number}`)
    }
    lines.push('', `ID Transaksi: ${trx.id}`)
    return lines.join('\n')
}

const sendDonationButtons = async (sock, jid, { title, body, footer, image, buttons }, opts = {}) => {
    try {
        const sent = await sock.sendInteractiveButton(
            jid,
            { title, body, footer, ...(image ? { image } : {}), buttons },
            opts
        )
        if (!sent?.key?.id) throw new Error('Pengiriman button tidak menghasilkan message id')
        return sent
    } catch (e) {
        console.error('sendInteractiveButton gagal, fallback ke text:', e)
        const manualLinks = (buttons || [])
            .map(b => (b.type === 'url' ? `${b.label}: ${b.url}` : null))
            .filter(Boolean)
            .join('\n')
        const fallbackText = `${body}${manualLinks ? `\n\n${manualLinks}` : ''}`
        return sock.sendMessage(jid, { text: fallbackText, ...(image ? { image: { url: image } } : {}) }, opts)
    }
}

const watchPayment = (sock, m, trx) => {
    const invId = trx.payment_info.inv_id
    if (!invId) return

    waitForPayment(invId, trx.payment_info.pending_url, 15 * 60 * 1000)
        .then(result => {
            const msg = {
                success: `🎉 Donasi *${trx.id}* sebesar ${formatRp(trx.amount)} dari ${trx.supporter} sudah *lunas*, makasih ya!`,
                expired: `⌛ Donasi *${trx.id}* sudah *kedaluwarsa* sebelum dibayar.`,
                failed: `❌ Donasi *${trx.id}* *gagal* diproses.`,
                not_found: `❌ Donasi *${trx.id}* tidak ditemukan saat pengecekan.`,
                error: `⚠️ Terjadi gangguan saat mengecek status donasi *${trx.id}*. Cek manual: ${trx.payment_info.pending_url}`,
                timeout: `⏱️ Belum ada update pembayaran untuk *${trx.id}* dalam 15 menit. Cek manual: ${trx.payment_info.pending_url}`
            }[result.status]
            if (msg) sock.sendMessage(m.from, { text: msg }, { quoted: m })
        })
        .catch(e => console.error('watchPayment error:', e))
}

export default {
    cmd: ['donate', 'donasi'],
    category: 'donasi',
    description: 'Buat link/QR donasi SociaBuzz',

    run: async (m, { sock, text, config }) => {
        const args = (text || '').trim().split(/\s+/).filter(Boolean)

        if (!args[0]) {
            const list = methodPayment().map(x => `- ${x.id}${x.need_phone ? ' (butuh no. hp)' : ''} (min ${formatRp(x.min_amount)})`).join('\n')
            return m.reply(
                `*Cara pakai:*\n.donate <nominal> [metode]\n\nContoh:\n.donate 10000\n.donate 15000 dana\n\n*Metode tersedia:*\n${list}`
            )
        }

        const amount = Number(args[0].replace(/[^\d]/g, ''))
        const method = (args[1] || 'qris').toLowerCase()

        if (!amount) return m.reply('Nominal tidak valid. Contoh: .donate 10000')

        await m.react('⏳')
        try {
            const trx = await createPayment(amount, {
                name: m.pushName || 'Donatur',
                message: `Donasi dari ${m.pushName || 'WhatsApp'} via ${config.botName}`,
                method,
                username: SOCIABUZZ_USERNAME
            })

            const pi = trx.payment_info
            const body = buildInfoText(trx)
            const directPayUrl = pi.redirect_url || pi.payment_link
            const buttons = []
            if (directPayUrl) buttons.push({ type: 'url', label: '💳 Bayar Sekarang', url: directPayUrl })
            if (pi.pending_url) buttons.push({ type: 'url', label: '🔍 Cek Status', url: pi.pending_url })

            const qrImageUrl = pi.qr_string
                ? 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(pi.qr_string)
                : null

            if (buttons.length || qrImageUrl) {
                await sendDonationButtons(sock, m.from, {
                    title: '✅ Donasi Berhasil Dibuat',
                    body,
                    footer: config.botName,
                    image: qrImageUrl,
                    buttons
                }, { quoted: m })
            } else {
                await m.reply(`✅ *Donasi berhasil dibuat!*\n\n${body}`)
            }

            await m.react('✅')
            watchPayment(sock, m, trx)
        } catch (e) {
            console.error(e)
            await m.react('❌')
            m.reply('Gagal membuat donasi: ' + e.message)
        }
    }
}
