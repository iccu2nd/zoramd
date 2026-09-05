const $ = (s, el = document) => el.querySelector(s)
let googleIdentity = null

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

function setGoogleBusy(on) {
  const fallback = $('#google-fallback')
  if (fallback) {
    fallback.disabled = on
    if (on) fallback.querySelector('span:last-child').textContent = 'Signing in...'
    else fallback.querySelector('span:last-child').textContent = 'Sign in with Google'
  }
}

function persistToken(token) {
  if (!token) return
  try {
    sessionStorage.setItem('zora_token', token)
    localStorage.setItem('zora_token', token)
  } catch (e) {}
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  try {
    const stored = sessionStorage.getItem('zora_token') || localStorage.getItem('zora_token')
    if (stored && !headers.Authorization) headers.Authorization = 'Bearer ' + stored
  } catch (e) {}
  const res = await fetch('/api' + path, { ...opts, headers, credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (data && data.token) persistToken(data.token)
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
  // Hanya izinkan path internal; backslash/newline dapat dinormalisasi browser
  // menjadi URL eksternal jika hanya dicek dengan startsWith('/').
  let safe = '/'
  if (next.startsWith('/') && !next.startsWith('//') && !/[\\\r\n]/.test(next)) {
    try {
      const parsed = new URL(next, location.origin)
      if (parsed.origin === location.origin) {
        safe = parsed.pathname + parsed.search + parsed.hash
      }
    } catch {}
  }
  location.href = safe
}

// Jika sudah login, langsung ke dashboard
async function checkExistingSession() {
  // Paint the auth UI immediately. Session validation runs in the background
  // so the Google button is visible without waiting for an API round trip.
  setLoading(false)
  showNoticeFromQuery()
  try {
    await api('/auth/me')
    setLoading(true, 'Already signed in, redirecting...')
    redirectToApp()
  } catch {}
}

function showNoticeFromQuery() {
  const reason = takeLoginReason()
  const notice = $('#auth-notice')
  if (!notice) return
  if (reason === 'connect') {
    notice.textContent = 'Please sign in first untuk menghubungkan bot.'
    show(notice)
  } else if (reason === 'required') {
    notice.textContent = 'Please sign in first untuk melanjutkan.'
    show(notice)
  } else if (reason === 'session') {
    notice.textContent = 'Your session expired. Please sign in again.'
    show(notice)
  } else {
    hide(notice)
  }
}

let pendingReg = null // { name, email, password }
let otpTimerInterval = null

function startOtpCountdown() {
  if (otpTimerInterval) clearInterval(otpTimerInterval)
  const expiresAt = Date.now() + 10 * 60 * 1000
  const el = $('#otp-timer')
  const tick = () => {
    const left = Math.max(0, expiresAt - Date.now())
    const m = Math.floor(left / 60000)
    const s = Math.floor((left % 60000) / 1000)
    if (el) el.textContent = left > 0 ? `Code valid for ${m}:${String(s).padStart(2, '0')} left` : 'Code expired. Click "Resend code"'
    if (left <= 0) clearInterval(otpTimerInterval)
  }
  tick()
  otpTimerInterval = setInterval(tick, 1000)
}

function showForm(id) {
  ;['login-form', 'register-form', 'otp-form'].forEach(fid => {
    const el = $('#' + fid)
    if (!el) return
    if (fid === id) show(el)
    else hide(el)
  })
}

function googleError(message = '') {
  const el = $('#google-error')
  if (el) el.textContent = message
}

async function handleGoogleCredential(response) {
  googleError('')
  if (!response?.credential) {
    googleError('Google Sign-In dibatalkan atau tidak menghasilkan token.')
    return
  }
  setGoogleBusy(true)
  try {
    const data = await api('/auth/google', {
      method: 'POST',
      body: JSON.stringify({
        credential: response.credential,
        termsAccepted: !!$('#reg-terms')?.checked
      })
    })
    persistToken(data.token)
    setLoading(true, 'Signed in with Google...')
    redirectToApp()
  } catch (err) {
    googleError(err.message || 'Google Sign-In gagal. Coba lagi.')
    setGoogleBusy(false)
  }
}

function waitForGoogleIdentityServices(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      if (window.google?.accounts?.id) return resolve(window.google.accounts.id)
      if (Date.now() - started >= timeoutMs) return reject(new Error('Google Sign-In tidak dapat dimuat'))
      setTimeout(check, 50)
    }
    check()
  })
}

async function initGoogleSignIn() {
  const fallback = $('#google-fallback')
  if (!fallback) return
  try {
    const config = await api('/auth/google/config')
    if (!config.enabled || !config.clientId) {
      fallback.disabled = true
      googleError('Google Sign-In belum tersedia. Gunakan email dan password.')
      return
    }
    const googleId = await waitForGoogleIdentityServices()
    googleId.initialize({
      client_id: config.clientId,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    })
    // Keep the visual button custom, but let GIS own the account chooser and
    // ID-token callback. No frontend user data is trusted.
    googleIdentity = googleId
    fallback.disabled = false
  } catch (err) {
    fallback.disabled = true
    googleError(err.message || 'Google Sign-In tidak dapat dimuat. Gunakan email dan password.')
  }
}

if ($('#google-fallback')) {
  $('#google-fallback').onclick = () => {
    if (!googleIdentity) {
      googleError('Google Sign-In sedang dimuat. Coba lagi sebentar.')
      return
    }
    googleError('')
    setGoogleBusy(true)
    googleIdentity.prompt((notification) => {
      if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
        setGoogleBusy(false)
        googleError('Google Sign-In tidak dapat dibuka. Coba lagi atau gunakan email dan password.')
      }
    })
  }
}

function getOtpCode() {
  return Array.from(document.querySelectorAll('.otp-digit')).map(i => i.value).join('')
}

function clearOtpBoxes() {
  document.querySelectorAll('.otp-digit').forEach(i => { i.value = '' })
  const first = document.querySelector('.otp-digit')
  if (first) first.focus()
}

function fillOtpBoxes(boxes, text) {
  const digits = text.replace(/\D/g, '').slice(0, 6)
  digits.split('').forEach((ch, i) => { if (boxes[i]) boxes[i].value = ch })
  if (digits.length === 6) { if ($('#otp-form')) $('#otp-form').requestSubmit() }
  else if (boxes[Math.min(digits.length, boxes.length - 1)]) boxes[Math.min(digits.length, boxes.length - 1)].focus()
}

function bindOtpBoxes() {
  const boxes = Array.from(document.querySelectorAll('.otp-digit'))
  if (!boxes.length) return
  boxes.forEach((box, idx) => {
    box.addEventListener('input', () => {
      const raw = box.value.replace(/\D/g, '')
      if (raw.length > 1) { fillOtpBoxes(boxes, raw); return }
      box.value = raw.slice(0, 1)
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
      fillOtpBoxes(boxes, (e.clipboardData || window.clipboardData).getData('text'))
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
    persistToken(data.token)
    setLoading(true, 'Signed in...')
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
    $('#reg-error').textContent = 'You must accept the Terms of Service'
    return
  }
  const name = ($('#reg-name').value || '').trim()
  const email = ($('#reg-email').value || '').trim()
  const password = $('#reg-password').value
  if (!name) {
    $('#reg-error').textContent = 'Name is required'
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
    if (hint) hint.textContent = '6-digit code sent to ' + email
    clearOtpBoxes()
    startOtpCountdown()
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
      if (errEl) errEl.textContent = 'Registration session expired. Fill the form again.'
      showForm('register-form')
      return
    }
    const code = getOtpCode()
    if (code.length !== 6) {
      if (errEl) errEl.textContent = 'Enter the 6-digit code'
      return
    }
    const btn = $('#otp-submit')
    if (btn) btn.disabled = true
    try {
      const data = await api('/auth/register/confirm', {
        method: 'POST',
        body: JSON.stringify({ email: pendingReg.email, code })
      })
      persistToken(data.token)
      pendingReg = null
      if (otpTimerInterval) clearInterval(otpTimerInterval)
      setLoading(true, 'Account created...')
      await new Promise(r => setTimeout(r, 400))
      redirectToApp()
    } catch (err) {
      if (errEl) errEl.textContent = err.message === 'Incorrect code' ? 'Incorrect code. Use the latest code from your email — older codes stop working after a resend.' : err.message
      if (btn) btn.disabled = false
    }
  }
}

const otpResend = $('#otp-resend')
if (otpResend) {
  otpResend.onclick = async () => {
    const errEl = $('#otp-error')
    if (!pendingReg) {
      if (errEl) errEl.textContent = 'Registration session expired. Fill the form again.'
      showForm('register-form')
      return
    }
    otpResend.disabled = true
    try {
      await api('/auth/register/resend', {
        method: 'POST',
        body: JSON.stringify(pendingReg)
      })
      if (errEl) { errEl.textContent = 'A new code was sent. Previous codes are no longer valid.'; errEl.style.color = '#166534' }
      clearOtpBoxes()
      startOtpCountdown()
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.color = '' }
    } finally {
      setTimeout(() => { otpResend.disabled = false }, 60000)
    }
  }
}

bindOtpBoxes()

checkExistingSession()
initGoogleSignIn()

// Safety net: jangan pernah stuck di loading > 4 detik
setTimeout(() => {
  const lv = $('#loading-view')
  if (lv && !lv.classList.contains('hidden') && getComputedStyle(lv).display !== 'none') {
    setLoading(false)
  }
}, 4000)
