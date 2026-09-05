export default {
    cmd: ['ping'],
    category: 'info',
    run: async (m, { sock, config }) => {
        // Pecah latency jadi 2 bagian, bukan cuma satu angka gabungan:
        // - "jaringan": dari timestamp WhatsApp sampai event masuk ke handler kita
        //   (di LUAR kendali kode bot -- socket/WA-side, retry receipt, dsb).
        // - "internal": dari handler mulai proses sampai .run() ini dieksekusi
        //   (di DALAM kendali kode bot -- ini yang bisa kita optimasi).
        const total = Date.now() - m.messageTimestamp * 1000
        const network = m.waNetworkDelayMs
        const internal = typeof m.tRecv === 'number' ? Date.now() - m.tRecv : null

        let text = `Pong! ${total}ms`
        if (network != null && internal != null) {
            text += `\n> Jaringan (WA→bot): ${network}ms\n> Internal (bot): ${internal}ms`
        }
        text += `\nBot: ${config.botName}`
        await m.reply(text)
    }
}
