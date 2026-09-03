const $ = (s, el = document) => el.querySelector(s)

function show(el) { el?.classList.remove('hidden') }
function hide(el) { el?.classList.add('hidden') }

function setLoading(on, text) {
  const el = $('#loading-view')
  const auth = $('#auth-view')
  if (on) {
    if (text && $('#loading-text')) $('#loading-text').textContent = text
    if (el) { el.classList.remove('hidden'); el.style.display = '' }
    if (auth) { auth.classList.add('hidden'); auth.style.display = 'none' }
  } else {
    if (el) { el.classList.add('hidden'); el.style.display = 'none' }
    if (auth) { auth.classList.remove('hidden'); auth.style.display = '' }
  }
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  const token = localStorage.getItem('token')
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch('/api' + path, { ...opts, headers, credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

function takeLoginNext() {
  let next = null
  try { next = sessionStorage.getItem('zora_login_next') } catch (e) {}
  if (!next) next = new URLSearchParams(location.search).get('next')
  try { sessionStorage.removeItem('zora_login_next') } catch (e) {}
  return next || '/dashboard'
}

function takeLoginReason() {
  let reason = null
  try { reason = sessionStorage.getItem('zora_login_reason') } catch (e) {}
  if (!reason) reason = new URLSearchParams(location.search).get('reason')
  try { sessionStorage.removeItem('zora_login_reason') } catch (e) {}
  return reason
}

function redirectToApp() {
  const next = takeLoginNext()
  // Hanya izinkan path relatif di domain yang sama
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  location.href = safe
}

// Jika sudah login, langsung ke dashboard
async function checkExistingSession() {
  setLoading(true, 'Memeriksa sesi...')
  const token = localStorage.getItem('token')
  if (!token) {
    await new Promise(r => setTimeout(r, 400))
    setLoading(false)
    showNoticeFromQuery()
    return
  }
  try {
    await api('/auth/me')
    setLoading(true, 'Sudah masuk, mengalihkan...')
    await new Promise(r => setTimeout(r, 300))
    redirectToApp()
  } catch {
    localStorage.removeItem('token')
    setLoading(false)
    showNoticeFromQuery()
  }
}

function showNoticeFromQuery() {
  const reason = takeLoginReason()
  const notice = $('#auth-notice')
  if (!notice) return
  if (reason === 'connect') {
    notice.textContent = 'Silakan masuk dulu untuk menghubungkan bot.'
    show(notice)
  } else if (reason === 'required') {
    notice.textContent = 'Silakan masuk dulu untuk melanjutkan.'
    show(notice)
  } else if (reason === 'session') {
    notice.textContent = 'Sesi berakhir. Silakan masuk lagi.'
    show(notice)
  } else {
    hide(notice)
  }
}

let pendingReg = null // { name, email, password }

function showForm(id) {
  ;['login-form', 'register-form', 'otp-form'].forEach(fid => {
    const el = $('#' + fid)
    if (!el) return
    if (fid === id) show(el)
    else hide(el)
  })
}

function getOtpCode() {
  return Array.from(document.querySelectorAll('.otp-digit')).map(i => i.value).join('')
}

function clearOtpBoxes() {
  document.querySelectorAll('.otp-digit').forEach(i => { i.value = '' })
  const first = document.querySelector('.otp-digit')
  if (first) first.focus()
}

function bindOtpBoxes() {
  const boxes = Array.from(document.querySelectorAll('.otp-digit'))
  if (!boxes.length) return
  boxes.forEach((box, idx) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(0, 1)
      if (box.value && idx < boxes.length - 1) boxes[idx + 1].focus()
      if (getOtpCode().length === 6) {
        const form = $('#otp-form')
        if (form) form.requestSubmit()
      }
    })
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && idx > 0) boxes[idx - 1].focus()
    })
    box.addEventListener('paste', (e) => {
      e.preventDefault()
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6)
      text.split('').forEach((ch, i) => { if (boxes[i]) boxes[i].value = ch })
      if (text.length === 6 && $('#otp-form')) $('#otp-form').requestSubmit()
      else if (boxes[Math.min(text.length, boxes.length - 1)]) boxes[Math.min(text.length, boxes.length - 1)].focus()
    })
  })
}

$('#go-register').onclick = (e) => {
  e.preventDefault()
  showForm('register-form')
  $('#login-error').textContent = ''
}

$('#go-login').onclick = (e) => {
  e.preventDefault()
  showForm('login-form')
  $('#reg-error').textContent = ''
  pendingReg = null
}

const otpBack = $('#otp-back')
if (otpBack) {
  otpBack.onclick = (e) => {
    e.preventDefault()
    showForm('register-form')
    $('#otp-error').textContent = ''
  }
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault()
  $('#login-error').textContent = ''
  const btn = $('#login-submit')
  btn.disabled = true
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#login-email').value,
        password: $('#login-password').value
      })
    })
    localStorage.setItem('token', data.token)
    setLoading(true, 'Berhasil masuk...')
    await new Promise(r => setTimeout(r, 400))
    redirectToApp()
  } catch (err) {
    $('#login-error').textContent = err.message
    btn.disabled = false
  }
}

$('#reg-terms').onchange = () => {
  $('#reg-submit').disabled = !$('#reg-terms').checked
}

$('#register-form').onsubmit = async (e) => {
  e.preventDefault()
  $('#reg-error').textContent = ''
  if (!$('#reg-terms').checked) {
    $('#reg-error').textContent = 'Kamu harus menyetujui Syarat & Ketentuan dulu'
    return
  }
  const name = ($('#reg-name').value || '').trim()
  const email = ($('#reg-email').value || '').trim()
  const password = $('#reg-password').value
  if (!name) {
    $('#reg-error').textContent = 'Nama wajib diisi'
    return
  }
  const btn = $('#reg-submit')
  btn.disabled = true
  try {
    await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    })
    pendingReg = { name, email, password }
    const hint = $('#otp-hint')
    if (hint) hint.textContent = 'Kode 6 digit dikirim ke ' + email
    clearOtpBoxes()
    showForm('otp-form')
  } catch (err) {
    $('#reg-error').textContent = err.message
  } finally {
    btn.disabled = !$('#reg-terms').checked
  }
}

const otpForm = $('#otp-form')
if (otpForm) {
  otpForm.onsubmit = async (e) => {
    e.preventDefault()
    const errEl = $('#otp-error')
    if (errEl) errEl.textContent = ''
    if (!pendingReg) {
      if (errEl) errEl.textContent = 'Sesi daftar habis, isi form lagi'
      showForm('register-form')
      return
    }
    const code = getOtpCode()
    if (code.length !== 6) {
      if (errEl) errEl.textContent = 'Masukkan 6 digit kode'
      return
    }
    const btn = $('#otp-submit')
    if (btn) btn.disabled = true
    try {
      const data = await api('/auth/register/confirm', {
        method: 'POST',
        body: JSON.stringify({ email: pendingReg.email, code })
      })
      localStorage.setItem('token', data.token)
      pendingReg = null
      setLoading(true, 'Akun dibuat...')
      await new Promise(r => setTimeout(r, 400))
      redirectToApp()
    } catch (err) {
      if (errEl) errEl.textContent = err.message
      if (btn) btn.disabled = false
    }
  }
}

const otpResend = $('#otp-resend')
if (otpResend) {
  otpResend.onclick = async () => {
    const errEl = $('#otp-error')
    if (!pendingReg) {
      if (errEl) errEl.textContent = 'Sesi daftar habis, isi form lagi'
      showForm('register-form')
      return
    }
    otpResend.disabled = true
    try {
      await api('/auth/register/resend', {
        method: 'POST',
        body: JSON.stringify(pendingReg)
      })
      if (errEl) { errEl.textContent = 'Kode baru dikirim.'; errEl.style.color = '#166534' }
      clearOtpBoxes()
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.color = '' }
    } finally {
      setTimeout(() => { otpResend.disabled = false }, 60000)
    }
  }
}

bindOtpBoxes()

checkExistingSession()

// Safety net: jangan pernah stuck di loading > 4 detik
setTimeout(() => {
  const lv = $('#loading-view')
  if (lv && !lv.classList.contains('hidden') && getComputedStyle(lv).display !== 'none') {
    setLoading(false)
  }
}, 4000)
