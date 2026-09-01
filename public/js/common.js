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

  const ctrl = new AbortController()
  const timeoutMs = opts.timeoutMs || 15000
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const res = await fetch('/api' + path, {
      ...opts,
      headers,
      credentials: 'include',
      signal: ctrl.signal
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      state.token = null
      state.user = null
      localStorage.removeItem('token')
      const err = new Error(data.error || 'Unauthorized')
      err.status = 401
      throw err
    }
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed')
    return data
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('Timeout: server tidak merespons. Coba refresh.')
      err.status = 408
      throw err
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function goToLogin(reason) {
  const params = new URLSearchParams()
  if (reason) params.set('reason', reason)
  const next = location.pathname + location.search + location.hash
  if (next && !next.startsWith('/login')) params.set('next', next)
  location.replace('/login?' + params.toString())
}

function setLoading(on, text) {
  const el = $('#loading-view')
  if (!el) return
  if (on) {
    if (text && $('#loading-text')) $('#loading-text').textContent = text
    el.classList.remove('hidden')
    const main = $('#main-view')
    if (main) main.classList.add('hidden')
  } else {
    el.classList.add('hidden')
  }
}

function showMainApp() {
  setLoading(false)
  const main = $('#main-view')
  if (main) main.classList.remove('hidden')
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
    try { await api('/auth/logout', { method: 'POST', timeoutMs: 5000 }) } catch {}
    state.token = null
    state.user = null
    localStorage.removeItem('token')
    location.replace('/login')
  })
  const path = location.pathname.replace(/\/$/, '') || '/'
  $$('.nav-item').forEach(a => {
    const href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/'
    if (href === path) a.classList.add('active')
    else a.classList.remove('active')
  })
}

async function loadBots() {
  const data = await api('/bots')
  state.bots = data.bots || []
  state.limits = data.limits || null
  return state.bots
}

function fillBotSelect(selectId) {
  const sel = $('#' + selectId)
  if (!sel) return
  const cur = sel.value
  sel.innerHTML = (state.bots || []).map(b =>
    `<option value="${escapeHtml(b.id)}">${escapeHtml(b.botName)} (${escapeHtml(b.status)})</option>`
  ).join('')
  if (cur) sel.value = cur
}

/** Auth gate + shell — never stuck on loading */
async function bootPage(pageInit) {
  try {
    setLoading(true, 'Memuat...')
    bindShell()

    if (!state.token) {
      goToLogin('required')
      return
    }

    setLoading(true, 'Memeriksa sesi...')
    try {
      const data = await api('/auth/me', { timeoutMs: 12000 })
      state.user = data.user
    } catch (e) {
      if (e.status === 401) {
        goToLogin('session')
        return
      }
      // Lainnya: tetap coba buka dashboard
      console.warn('auth/me failed', e)
    }

    setLoading(true, 'Memuat data...')
    try {
      await loadBots()
    } catch (e) {
      if (e.status === 401) {
        goToLogin('session')
        return
      }
      console.warn('loadBots failed', e)
      state.bots = []
    }

    showMainApp()

    if (typeof pageInit === 'function') {
      try {
        await pageInit()
      } catch (e) {
        console.warn('pageInit failed', e)
      }
    }
  } catch (e) {
    console.error('bootPage fatal', e)
    showMainApp()
    const box = $('#bots-list') || $('#connect-status') || document.querySelector('main')
    if (box && e.message) {
      const p = document.createElement('p')
      p.className = 'error'
      p.textContent = e.message
      box.prepend?.(p)
    }
  } finally {
    // Pastikan loading selalu hilang
    setLoading(false)
    if ($('#main-view')?.classList.contains('hidden') && state.token) {
      showMainApp()
    }
  }
}

window.Zora = {
  $, $$, show, hide, escapeHtml, state, api, goToLogin,
  setLoading, showMainApp, bindShell, loadBots, fillBotSelect, bootPage
}
