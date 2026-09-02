const $ = (s, el = document) => el.querySelector(s)

function show(el) { el?.classList.remove('hidden') }
function hide(el) { el?.classList.add('hidden') }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  const res = await fetch('/api' + path, { ...opts, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

let currentEmail = ''

$('#request-form').onsubmit = async (e) => {
  e.preventDefault()
  $('#request-error').textContent = ''
  const btn = $('#request-submit')
  btn.disabled = true
  try {
    currentEmail = $('#fp-email').value.trim().toLowerCase()
    await api('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: currentEmail }) })
    hide($('#request-form'))
    show($('#reset-form'))
    const notice = $('#notice')
    notice.textContent = 'Kalau email terdaftar, kode OTP sudah dikirim. Cek inbox kamu.'
    show(notice)
  } catch (err) {
    $('#request-error').textContent = err.message
  } finally {
    btn.disabled = false
  }
}

$('#reset-form').onsubmit = async (e) => {
  e.preventDefault()
  $('#reset-error').textContent = ''
  const btn = $('#reset-submit')
  btn.disabled = true
  try {
    await api('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({
        email: currentEmail,
        code: $('#fp-code').value.trim(),
        newPassword: $('#fp-password').value
      })
    })
    const notice = $('#notice')
    notice.textContent = 'Password berhasil direset. Mengalihkan ke halaman masuk...'
    show(notice)
    await new Promise(r => setTimeout(r, 1200))
    location.href = '/login'
  } catch (err) {
    $('#reset-error').textContent = err.message
    btn.disabled = false
  }
}

$('#resend-link').onclick = async (e) => {
  e.preventDefault()
  try {
    await api('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: currentEmail }) })
    const notice = $('#notice')
    notice.textContent = 'Kode baru sudah dikirim (kalau belum lewat 1 menit dari permintaan sebelumnya).'
    show(notice)
  } catch (err) {
    $('#reset-error').textContent = err.message
  }
}
