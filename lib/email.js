// Kirim email transaksional lewat Resend API. Pakai fetch bawaan Node (>=18), gak nambah dependency.

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM = 'Botzora <noreply@botzora.my.id>'

async function sendEmail({ to, subject, html }) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
        console.error('[email] RESEND_API_KEY belum diset di environment')
        throw new Error('Layanan email belum dikonfigurasi')
    }
    const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from: FROM, to, subject, html })
    })
    if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error('[email] Resend gagal:', res.status, body)
        throw new Error('Gagal mengirim email')
    }
    return res.json()
}

function otpHtml({ title, code, note }) {
    return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 8px">${title}</h2>
  <p style="color:#444;margin:0 0 16px">${note}</p>
  <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f4f4f5;padding:18px;text-align:center;border-radius:12px">${code}</div>
  <p style="color:#888;font-size:13px;margin-top:16px">Kode ini berlaku 10 menit. Kalau kamu tidak meminta ini, abaikan saja email ini.</p>
  <p style="color:#aaa;font-size:12px;margin-top:24px">— ZoraBot</p>
</div>`.trim()
}

export async function sendVerificationOtp(email, code) {
    return sendEmail({
        to: email,
        subject: 'Kode Verifikasi Email — ZoraBot',
        html: otpHtml({
            title: 'Verifikasi Email',
            code,
            note: 'Masukkan kode berikut untuk memverifikasi email akunmu di ZoraBot.'
        })
    })
}

export async function sendPasswordResetOtp(email, code) {
    return sendEmail({
        to: email,
        subject: 'Kode Reset Password — ZoraBot',
        html: otpHtml({
            title: 'Reset Password',
            code,
            note: 'Masukkan kode berikut untuk mengatur ulang password akunmu di ZoraBot.'
        })
    })
}
