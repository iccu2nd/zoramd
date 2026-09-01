const $ = (s, el = document) => el.querySelector(s)

function show(el) { el?.classList.remove('hidden') }
function hide(el) { el?.classList.add('hidden') }

function setLoading(on, text) {
  const el = $('#loading-view')
  if (!el) return
  if (on) {
    if (text) $('#loading-text').textContent = text
    show(el)
    hide($('#auth-view'))
  } else {
    hide(el)
    show($('#auth-view'))
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

function redirectToApp() {
  const params = new URLSearchParams(location.search)
  const next = params.get('next') || '/'
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
  const params = new URLSearchParams(location.search)
  const reason = params.get('reason')
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

$('#tab-login').onclick = () => {
  $('#tab-login').classList.add('active')
  $('#tab-register').classList.remove('active')
  show($('#login-form'))
  hide($('#register-form'))
}

$('#tab-register').onclick = () => {
  $('#tab-register').classList.add('active')
  $('#tab-login').classList.remove('active')
  hide($('#login-form'))
  show($('#register-form'))
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

$('#register-form').onsubmit = async (e) => {
  e.preventDefault()
  $('#reg-error').textContent = ''
  const btn = $('#reg-submit')
  btn.disabled = true
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#reg-name').value,
        email: $('#reg-email').value,
        password: $('#reg-password').value
      })
    })
    localStorage.setItem('token', data.token)
    setLoading(true, 'Akun dibuat, mengalihkan...')
    await new Promise(r => setTimeout(r, 400))
    redirectToApp()
  } catch (err) {
    $('#reg-error').textContent = err.message
    btn.disabled = false
  }
}

checkExistingSession()
