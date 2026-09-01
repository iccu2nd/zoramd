/** Shared helpers for multi-page dashboard */
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]

function show(el) { el?.classList.remove('hidden') }
function hide(el) { el?.classList.add('hidden') }

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const state = {
  token: localStorage.getItem('token') || null,
  user: null,
  bots: [],
  pollTimer: null
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (state.token) headers.Authorization = `Bearer ${state.token}`
  const res = await fetch('/api' + path, { ...opts, headers, credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
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

function goToLogin(reason) {
  const params = new URLSearchParams()
  if (reason) params.set('reason', reason)
  params.set('next', location.pathname + location.search + location.hash)
  location.href = '/login?' + params.toString()
}

function setLoading(on, text) {
  const el = $('#loading-view')
  if (!el) return
  if (on) {
    if (text) $('#loading-text').textContent = text
    show(el)
    hide($('#main-view'))
  } else {
    hide(el)
  }
}

function showMainApp() {
  setLoading(false)
  show($('#main-view'))
  if ($('#user-chip')) $('#user-chip').textContent = state.user?.email || ''
}

function bindShell() {
  $('#menu-btn')?.addEventListener('click', () => {
    $('#sidebar')?.classList.add('open')
    $('#sidebar-overlay')?.classList.add('show')
  })
  $('#sidebar-overlay')?.addEventListener('click', () => {
    $('#sidebar')?.classList.remove('open')
    $('#sidebar-overlay')?.classList.remove('show')
  })
  $('#logout-btn')?.addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    state.token = null
    state.user = null
    localStorage.removeItem('token')
    location.href = '/login'
  })
  // Highlight active nav by path
  const path = location.pathname.replace(/\/$/, '') || '/'
  $$('.nav-item').forEach(a => {
    const href = a.getAttribute('href') || ''
    const clean = href.replace(/\.html$/, '').replace(/\/$/, '') || '/'
    const here = path.replace(/\.html$/, '') || '/'
    if (href === path || clean === here || (here === '/' && (href === '/' || href === '/dashboard'))) {
      a.classList.add('active')
    } else {
      a.classList.remove('active')
    }
  })
}

async function loadBots() {
  const data = await api('/bots')
  state.bots = data.bots || []
  return state.bots
}

function fillBotSelect(selectId) {
  const sel = $('#' + selectId)
  if (!sel) return
  const cur = sel.value
  sel.innerHTML = state.bots.map(b =>
    `<option value="${escapeHtml(b.id)}">${escapeHtml(b.botName)} (${escapeHtml(b.status)})</option>`
  ).join('')
  if (cur) sel.value = cur
}

/** Auth gate + shell for dashboard pages */
async function bootPage(pageInit) {
  setLoading(true, 'Memuat ZoraBot...')
  bindShell()

  if (!state.token) {
    goToLogin('required')
    return
  }

  try {
    setLoading(true, 'Memeriksa sesi...')
    const data = await api('/auth/me')
    state.user = data.user
    setLoading(true, 'Memuat data...')
    await loadBots()
    showMainApp()
    if (typeof pageInit === 'function') await pageInit()
  } catch (e) {
    if (e.status === 401 || !state.token) goToLogin('session')
    else {
      setLoading(false)
      showMainApp()
      alert(e.message || 'Gagal memuat')
    }
  }
}

window.Zora = {
  $, $$, show, hide, escapeHtml, state, api, goToLogin,
  setLoading, showMainApp, bindShell, loadBots, fillBotSelect, bootPage
}
