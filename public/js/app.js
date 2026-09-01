const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]

const state = {
  token: localStorage.getItem('token') || null,
  user: null,
  bots: [],
  currentPage: 'dashboard',
  pollTimer: null
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (state.token) headers.Authorization = `Bearer ${state.token}`
  const res = await fetch('/api' + path, { ...opts, headers, credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    // Sesi habis → paksa login
    state.token = null
    state.user = null
    localStorage.removeItem('token')
    const err = new Error(data.error || 'Unauthorized')
    err.status = 401
    throw err
  }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

function show(el) { el?.classList.remove('hidden') }
function hide(el) { el?.classList.add('hidden') }

function setLoading(showLoading, text) {
  const el = $('#loading-view')
  if (!el) return
  if (showLoading) {
    if (text) $('#loading-text').textContent = text
    show(el)
  } else {
    hide(el)
  }
}

function setAuthView(loggedIn) {
  setLoading(false)
  if (loggedIn) {
    hide($('#auth-view'))
    show($('#main-view'))
    $('#user-chip').textContent = state.user?.email || ''
  } else {
    show($('#auth-view'))
    hide($('#main-view'))
  }
}

/** Wajib login dulu sebelum akses fitur (termasuk Connect Bot) */
function requireLogin(actionLabel) {
  if (state.token && state.user) return true
  setAuthView(false)
  const msg = actionLabel
    ? `Silakan masuk dulu untuk ${actionLabel}.`
    : 'Silakan masuk dulu untuk melanjutkan.'
  const err = $('#login-error')
  if (err) err.textContent = msg
  // Pastikan tab login aktif
  $('#tab-login')?.classList.add('active')
  $('#tab-register')?.classList.remove('active')
  show($('#login-form'))
  hide($('#register-form'))
  return false
}

// ----- Auth -----
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
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#login-email').value,
        password: $('#login-password').value
      })
    })
    state.token = data.token
    state.user = data.user
    localStorage.setItem('token', data.token)
    hide($('#auth-view'))
    setLoading(true, 'Memuat dashboard...')
    await loadBots()
    setAuthView(true)
    navigate('dashboard')
  } catch (err) {
    $('#login-error').textContent = err.message
  }
}

$('#register-form').onsubmit = async (e) => {
  e.preventDefault()
  $('#reg-error').textContent = ''
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#reg-name').value,
        email: $('#reg-email').value,
        password: $('#reg-password').value
      })
    })
    state.token = data.token
    state.user = data.user
    localStorage.setItem('token', data.token)
    hide($('#auth-view'))
    setLoading(true, 'Memuat dashboard...')
    await loadBots()
    setAuthView(true)
    navigate('dashboard')
  } catch (err) {
    $('#reg-error').textContent = err.message
  }
}

$('#logout-btn').onclick = async () => {
  try { await api('/auth/logout', { method: 'POST' }) } catch {}
  state.token = null
  state.user = null
  localStorage.removeItem('token')
  setAuthView(false)
}

// ----- Sidebar -----
$('#menu-btn').onclick = () => {
  $('#sidebar').classList.add('open')
  $('#sidebar-overlay').classList.add('show')
}
$('#sidebar-overlay').onclick = closeSidebar
function closeSidebar() {
  $('#sidebar').classList.remove('open')
  $('#sidebar-overlay').classList.remove('show')
}

$$('.nav-item').forEach(a => {
  a.onclick = (e) => {
    e.preventDefault()
    navigate(a.dataset.page)
    closeSidebar()
  }
})

function navigate(page) {
  // Semua halaman dashboard butuh login
  if (!requireLogin(page === 'connect' ? 'menghubungkan bot' : null)) return

  state.currentPage = page
  $$('.page').forEach(p => p.classList.add('hidden'))
  show($('#page-' + page))
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page))
  if (page === 'dashboard') renderBots()
  if (page === 'connect') fillBotSelects()
  if (page === 'bot-settings') { fillBotSelects(); loadSettings() }
  if (page === 'feature-settings') { fillBotSelects(); loadFeatures() }
  if (page === 'upgrade') { fillBotSelects(); loadPremium() }
  if (page === 'account') renderAccount()
}

// ----- Bots -----
async function loadBots() {
  const data = await api('/bots')
  state.bots = data.bots || []
  renderBots()
  fillBotSelects()
}

function renderBots() {
  const list = $('#bots-list')
  if (!state.bots.length) {
    list.innerHTML = '<p class="hint">Belum ada bot. Buat bot baru untuk memulai.</p>'
    return
  }
  list.innerHTML = state.bots.map(b => `
    <div class="bot-card">
      <div>
        <h3>${escapeHtml(b.botName)}</h3>
        <div class="bot-meta">${escapeHtml(b.sessionId)}</div>
      </div>
      <div style="text-align:right">
        <span class="badge ${b.status}">${b.status}</span>
        ${b.plan === 'premium' ? '<span class="badge premium">Premium</span>' : ''}
      </div>
    </div>
  `).join('')
}

$('#create-bot-btn').onclick = async () => {
  const name = prompt('Nama bot:', 'ZoraBot')
  if (name === null) return
  try {
    await api('/bots', { method: 'POST', body: JSON.stringify({ botName: name || 'ZoraBot' }) })
    await loadBots()
  } catch (e) {
    alert(e.message)
  }
}

function fillBotSelects() {
  const ids = ['connect-bot-select', 'settings-bot-select', 'feature-bot-select', 'upgrade-bot-select']
  ids.forEach(id => {
    const sel = $('#' + id)
    if (!sel) return
    const cur = sel.value
    sel.innerHTML = state.bots.map(b =>
      `<option value="${b.id}">${escapeHtml(b.botName)} (${b.status})</option>`
    ).join('')
    if (cur) sel.value = cur
  })
}

function selectedBotId(selectId) {
  return $('#' + selectId)?.value
}

// ----- Connect -----
$$('input[name="connect-method"]').forEach(r => {
  r.onchange = () => {
    if (r.value === 'pairing' && r.checked) show($('#pairing-phone-wrap'))
    else hide($('#pairing-phone-wrap'))
  }
})

$('#connect-start-btn').onclick = async () => {
  if (!requireLogin('menghubungkan bot')) return
  const botId = selectedBotId('connect-bot-select')
  if (!botId) return alert('Pilih bot dulu')
  const method = $('input[name="connect-method"]:checked')?.value || 'qr'
  const phoneNumber = $('#pairing-phone').value
  $('#connect-status').innerHTML = '<div class="inline-loading"><span class="dot-spinner"></span> Menghubungkan bot...</div>'
  hide($('#qr-wrap'))
  hide($('#pairing-code-wrap'))
  $('#connect-start-btn').disabled = true
  try {
    const data = await api(`/bots/${botId}/connect`, {
      method: 'POST',
      body: JSON.stringify({ method, phoneNumber })
    })
    updateConnectUI(data.state)
    startStatusPoll(botId)
  } catch (e) {
    if (e.message === 'Unauthorized' || /unauthorized|token/i.test(e.message)) {
      requireLogin('menghubungkan bot')
      $('#connect-status').textContent = 'Sesi berakhir. Silakan masuk lagi.'
    } else {
      $('#connect-status').textContent = e.message
    }
  } finally {
    $('#connect-start-btn').disabled = false
  }
}

$('#connect-stop-btn').onclick = async () => {
  const botId = selectedBotId('connect-bot-select')
  if (!botId) return
  stopStatusPoll()
  try {
    await api(`/bots/${botId}/disconnect`, { method: 'POST', body: JSON.stringify({}) })
    $('#connect-status').textContent = 'Terputus'
    hide($('#qr-wrap'))
    hide($('#pairing-code-wrap'))
    await loadBots()
  } catch (e) {
    alert(e.message)
  }
}

$('#connect-logout-btn').onclick = async () => {
  const botId = selectedBotId('connect-bot-select')
  if (!botId) return
  if (!confirm('Logout session? Bot harus pairing ulang.')) return
  stopStatusPoll()
  try {
    await api(`/bots/${botId}/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ clearSession: true })
    })
    $('#connect-status').textContent = 'Session dihapus'
    hide($('#qr-wrap'))
    hide($('#pairing-code-wrap'))
    await loadBots()
  } catch (e) {
    alert(e.message)
  }
}

function updateConnectUI(st) {
  if (!st) return
  $('#connect-status').textContent = `Status: ${st.status}` + (st.lastError ? ` (${st.lastError})` : '')
  if (st.qr) {
    show($('#qr-wrap'))
    $('#qr-img').src = st.qr
  } else {
    hide($('#qr-wrap'))
  }
  if (st.pairingCode) {
    show($('#pairing-code-wrap'))
    $('#pairing-code').textContent = st.pairingCode
  } else {
    hide($('#pairing-code-wrap'))
  }
}

function startStatusPoll(botId) {
  stopStatusPoll()
  state.pollTimer = setInterval(async () => {
    try {
      const data = await api(`/bots/${botId}/status`)
      updateConnectUI(data.state)
      if (data.state?.status === 'connected' || data.state?.status === 'disconnected') {
        await loadBots()
        if (data.state.status === 'connected') stopStatusPoll()
      }
    } catch {}
  }, 2500)
}
function stopStatusPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer)
  state.pollTimer = null
}

// ----- Settings -----
$('#settings-bot-select').onchange = loadSettings
async function loadSettings() {
  const botId = selectedBotId('settings-bot-select')
  if (!botId) return
  try {
    const data = await api(`/bots/${botId}/settings`)
    const s = data.settings || {}
    $('#set-mode').value = s.mode || 'public'
    $('#set-autoread').checked = !!s.autoread
    $('#set-autotyping').checked = !!s.autotyping
    $('#set-noprefix').checked = !!s.noprefix
    $('#set-botname').value = data.botName || ''
    $('#set-ownernumber').value = data.ownerNumber || ''
    const id = data.identity || {}
    $('#set-channelurl').value = id.channelUrl || ''
    $('#set-groupurl').value = id.groupUrl || ''
    const disabled = !data.isPremium
    ;['set-botname','set-ownernumber','set-channelurl','set-groupurl'].forEach(id => {
      $('#' + id).disabled = disabled
    })
    $('#premium-hint').textContent = data.isPremium
      ? 'Akun Premium aktif — semua pengaturan tersedia.'
      : 'Fitur di bawah hanya untuk Premium. Upgrade di menu Upgrade Plan.'
  } catch (e) {
    $('#settings-msg').textContent = e.message
  }
}

$('#save-settings-btn').onclick = async () => {
  const botId = selectedBotId('settings-bot-select')
  if (!botId) return
  $('#settings-msg').textContent = ''
  try {
    await api(`/bots/${botId}/settings`, {
      method: 'PUT',
      body: JSON.stringify({
        mode: $('#set-mode').value,
        autoread: $('#set-autoread').checked,
        autotyping: $('#set-autotyping').checked,
        noprefix: $('#set-noprefix').checked,
        botName: $('#set-botname').value,
        ownerNumber: $('#set-ownernumber').value,
        identity: {
          channelUrl: $('#set-channelurl').value,
          groupUrl: $('#set-groupurl').value
        }
      })
    })
    $('#settings-msg').textContent = 'Tersimpan'
    $('#settings-msg').className = 'msg ok'
    await loadBots()
  } catch (e) {
    $('#settings-msg').textContent = e.message
    $('#settings-msg').className = 'msg err'
  }
}

// ----- Features -----
const COMMON_FEATURES = [
  'menu', 'sticker', 'play', 'ytmp3', 'ytmp4', 'tiktok', 'igdl', 'pinterest',
  'ai', 'hd', 'smeme', 'welcome', 'antilink', 'antispam', 'promote', 'demote',
  'hidetag', 'broadcast', 'afk', 'owner', 'ping'
]

$('#feature-bot-select').onchange = loadFeatures
async function loadFeatures() {
  const botId = selectedBotId('feature-bot-select')
  if (!botId) return
  const wrap = $('#features-list')
  wrap.innerHTML = '<p class="hint">Memuat...</p>'
  try {
    const data = await api(`/bots/${botId}/features`)
    const map = {}
    ;(data.features || []).forEach(f => { map[f.featureKey] = f })
    const keys = [...new Set([...COMMON_FEATURES, ...Object.keys(map)])]
    wrap.innerHTML = keys.map(key => {
      const f = map[key] || { featureKey: key, enabled: true, accessRule: 'public', customResponse: '', customCommand: '' }
      return `
        <div class="feature-item" data-key="${escapeHtml(key)}">
          <div class="top">
            <span class="name">${escapeHtml(key)}</span>
            <label><input type="checkbox" class="feat-enabled" ${f.enabled !== false ? 'checked' : ''}/> ON</label>
          </div>
          <div class="extra">
            <label>Access Rule</label>
            <select class="feat-access" ${data.isPremium ? '' : 'disabled'}>
              ${(data.accessRules || ['public']).map(r =>
                `<option value="${r}" ${f.accessRule === r ? 'selected' : ''}>${r}</option>`
              ).join('')}
            </select>
            <label>Custom Response</label>
            <input class="feat-response" type="text" value="${escapeHtml(f.customResponse || '')}" ${data.isPremium ? '' : 'disabled'} placeholder="Kosongkan = default" />
            <label>Custom Command</label>
            <input class="feat-command" type="text" value="${escapeHtml(f.customCommand || '')}" ${data.isPremium ? '' : 'disabled'} placeholder="Kosongkan = default" />
            <button class="btn outline feat-save" style="margin-top:8px">Simpan</button>
          </div>
        </div>`
    }).join('')

    wrap.querySelectorAll('.feature-item').forEach(item => {
      item.querySelector('.top').onclick = (e) => {
        if (e.target.closest('input')) return
        item.classList.toggle('open')
      }
      item.querySelector('.feat-enabled').onchange = async (e) => {
        try {
          await api(`/bots/${botId}/features/${item.dataset.key}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled: e.target.checked })
          })
        } catch (err) { alert(err.message) }
      }
      item.querySelector('.feat-save').onclick = async () => {
        try {
          await api(`/bots/${botId}/features/${item.dataset.key}`, {
            method: 'PUT',
            body: JSON.stringify({
              enabled: item.querySelector('.feat-enabled').checked,
              accessRule: item.querySelector('.feat-access').value,
              customResponse: item.querySelector('.feat-response').value || null,
              customCommand: item.querySelector('.feat-command').value || null
            })
          })
          alert('Tersimpan')
        } catch (err) { alert(err.message) }
      }
    })
  } catch (e) {
    wrap.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`
  }
}

// ----- Upgrade -----
$('#upgrade-bot-select').onchange = loadPremium
async function loadPremium() {
  const botId = selectedBotId('upgrade-bot-select')
  if (!botId) return
  try {
    const data = await api(`/bots/${botId}/premium`)
    const sub = data.subscription || {}
    $('#sub-status').textContent = data.isPremium
      ? `Premium aktif sampai ${sub.expiresAt ? new Date(sub.expiresAt).toLocaleString('id-ID') : '-'}`
      : 'Paket saat ini: Free'
  } catch (e) {
    $('#sub-status').textContent = e.message
  }
}

$('#order-premium-btn').onclick = async () => {
  const botId = selectedBotId('upgrade-bot-select')
  if (!botId) return
  $('#upgrade-msg').textContent = ''
  try {
    const data = await api(`/bots/${botId}/premium/order`, {
      method: 'POST',
      body: JSON.stringify({ method: $('#pay-method').value })
    })
    show($('#payment-info'))
    const p = data.payment || {}
    $('#payment-info').innerHTML = `
      <strong>Order ID:</strong> ${escapeHtml(data.orderId)}<br/>
      <strong>Jumlah:</strong> Rp${data.amount.toLocaleString('id-ID')}<br/>
      ${p.qr_string || p.qrUrl || p.payment_url || p.url
        ? `<div style="margin-top:8px">Ikuti instruksi pembayaran dari SociaBuzz / scan QR yang diberikan.</div>`
        : ''}
      <pre style="margin-top:8px;font-size:12px;white-space:pre-wrap">${escapeHtml(JSON.stringify(p, null, 2).slice(0, 800))}</pre>
    `
    $('#check-order-id').value = data.orderId
    $('#upgrade-msg').textContent = 'Order dibuat. Selesaikan pembayaran lalu tekan Cek Status.'
    $('#upgrade-msg').className = 'msg ok'
  } catch (e) {
    $('#upgrade-msg').textContent = e.message
    $('#upgrade-msg').className = 'msg err'
  }
}

$('#check-payment-btn').onclick = async () => {
  const botId = selectedBotId('upgrade-bot-select')
  const orderId = $('#check-order-id').value.trim()
  if (!botId || !orderId) return alert('Isi Order ID')
  try {
    const data = await api(`/bots/${botId}/premium/check`, {
      method: 'POST',
      body: JSON.stringify({ orderId })
    })
    if (data.status === 'paid') {
      $('#upgrade-msg').textContent = 'Pembayaran valid. Premium diaktifkan!'
      $('#upgrade-msg').className = 'msg ok'
      await loadPremium()
      await loadBots()
    } else {
      $('#upgrade-msg').textContent = 'Masih pending. Selesaikan pembayaran lalu cek lagi.'
      $('#upgrade-msg').className = 'msg'
    }
  } catch (e) {
    $('#upgrade-msg').textContent = e.message
    $('#upgrade-msg').className = 'msg err'
  }
}

function renderAccount() {
  $('#account-info').innerHTML = `
    <p><strong>Email</strong><br/>${escapeHtml(state.user?.email || '-')}</p>
    <p style="margin-top:12px"><strong>Nama</strong><br/>${escapeHtml(state.user?.name || '-')}</p>
    <p style="margin-top:12px"><strong>User ID</strong><br/>${escapeHtml(state.user?.id || '-')}</p>
  `
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ----- Init -----
async function init() {
  // Tampilkan loading dulu
  hide($('#auth-view'))
  hide($('#main-view'))
  setLoading(true, 'Memuat ZoraBot...')

  // Minimal delay supaya loading terlihat (UX)
  const minDelay = new Promise(r => setTimeout(r, 600))

  try {
    if (state.token) {
      setLoading(true, 'Memeriksa sesi...')
      const [, data] = await Promise.all([
        minDelay,
        api('/auth/me').catch(() => null)
      ])
      if (data?.user) {
        state.user = data.user
        setLoading(true, 'Memuat dashboard...')
        await loadBots()
        setAuthView(true)
        navigate('dashboard')
        return
      }
      // Token invalid
      localStorage.removeItem('token')
      state.token = null
      state.user = null
    } else {
      await minDelay
    }
  } catch {
    localStorage.removeItem('token')
    state.token = null
    state.user = null
  }

  // Belum login → halaman masuk
  setLoading(true, 'Menyiapkan halaman masuk...')
  await new Promise(r => setTimeout(r, 300))
  setAuthView(false)
}

init()
