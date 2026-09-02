/* ZoraBot shared client — v3 */
(function (global) {
  'use strict'

  function $(s, el) { return (el || document).querySelector(s) }
  function $$(s, el) { return Array.from((el || document).querySelectorAll(s)) }
  function show(el) { if (el) el.classList.remove('hidden') }
  function hide(el) { if (el) el.classList.add('hidden') }
  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  var state = {
    token: null,
    user: null,
    bots: [],
    limits: null,
    pollTimer: null
  }
  try { state.token = localStorage.getItem('token') || null } catch (e) {}

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false
      var t = setTimeout(function () {
        if (done) return
        done = true
        var err = new Error((label || 'Request') + ' timeout')
        err.status = 408
        reject(err)
      }, ms || 12000)
      promise.then(function (v) {
        if (done) return
        done = true
        clearTimeout(t)
        resolve(v)
      }, function (e) {
        if (done) return
        done = true
        clearTimeout(t)
        reject(e)
      })
    })
  }

  async function api(path, opts) {
    opts = opts || {}
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
    if (state.token) headers.Authorization = 'Bearer ' + state.token

    var fetchOpts = {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'include'
    }
    if (opts.body != null) fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)

    var res = await withTimeout(fetch('/api' + path, fetchOpts), opts.timeoutMs || 12000, path)
    var data = {}
    try { data = await res.json() } catch (e) {}

    if (res.status === 401) {
      state.token = null
      state.user = null
      try { localStorage.removeItem('token') } catch (e) {}
      var err = new Error(data.error || 'Unauthorized')
      err.status = 401
      throw err
    }
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed')
    return data
  }

  function goToLogin(reason) {
    var params = new URLSearchParams()
    if (reason) params.set('reason', reason)
    var next = location.pathname + location.search
    if (next && next.indexOf('/login') !== 0) params.set('next', next)
    location.replace('/login?' + params.toString())
  }

  function setLoading(on, text) {
    var el = document.getElementById('loading-view')
    if (!el) return
    if (text) {
      var t = document.getElementById('loading-text')
      if (t) t.textContent = text
    }
    if (on) {
      el.classList.remove('hidden')
      el.style.display = ''
    } else {
      el.classList.add('hidden')
      el.style.display = 'none'
    }
  }

  function showMainApp() {
    setLoading(false)
    var main = document.getElementById('main-view')
    if (main) {
      main.classList.remove('hidden')
      main.style.display = ''
    }
    var chip = document.getElementById('user-chip')
    if (chip && state.user) chip.textContent = state.user.email || ''
  }

  function bindShell() {
    var menuBtn = document.getElementById('menu-btn')
    var sidebar = document.getElementById('sidebar')
    var overlay = document.getElementById('sidebar-overlay')
    if (menuBtn && sidebar) {
      menuBtn.onclick = function () {
        sidebar.classList.add('open')
        if (overlay) overlay.classList.add('show')
      }
    }
    if (overlay && sidebar) {
      overlay.onclick = function () {
        sidebar.classList.remove('open')
        overlay.classList.remove('show')
      }
    }
    var logoutBtn = document.getElementById('logout-btn')
    if (logoutBtn) {
      logoutBtn.onclick = function () {
        state.token = null
        state.user = null
        try { localStorage.removeItem('token') } catch (e) {}
        location.replace('/login')
      }
    }
    var path = (location.pathname || '/').replace(/\/$/, '') || '/'
    $$('.nav-item').forEach(function (a) {
      var href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/'
      if (href === path) a.classList.add('active')
      else a.classList.remove('active')
    })
  }

  async function loadBots() {
    var data = await api('/bots')
    state.bots = data.bots || []
    state.limits = data.limits || null
    return state.bots
  }

  function fillBotSelect(selectId) {
    var sel = document.getElementById(selectId)
    if (!sel) return
    var cur = sel.value
    var bots = state.bots || []
    sel.innerHTML = bots.map(function (b) {
      return '<option value="' + escapeHtml(b.id) + '">' + escapeHtml(b.botName) + ' (' + escapeHtml(b.status) + ')</option>'
    }).join('')
    if (cur) sel.value = cur
  }

  async function bootPage(pageInit) {
    // Safety: hide loading after 8s no matter what
    var safety = setTimeout(function () {
      showMainApp()
    }, 8000)

    try {
      setLoading(true, 'Memuat...')
      bindShell()

      if (!state.token) {
        clearTimeout(safety)
        goToLogin('required')
        return
      }

      setLoading(true, 'Memeriksa sesi...')
      try {
        var me = await api('/auth/me', { timeoutMs: 10000 })
        state.user = me.user
        var navAd = document.getElementById('nav-admin')
        if (navAd && me.user && me.user.isAdmin) navAd.classList.remove('hidden')
      } catch (e) {
        if (e.status === 401) {
          clearTimeout(safety)
          goToLogin('session')
          return
        }
        console.warn('auth/me', e)
      }

      setLoading(true, 'Memuat data...')
      try {
        await loadBots()
      } catch (e) {
        if (e.status === 401) {
          clearTimeout(safety)
          goToLogin('session')
          return
        }
        console.warn('bots', e)
        state.bots = []
      }

      showMainApp()
      clearTimeout(safety)

      if (typeof pageInit === 'function') {
        try { await pageInit() } catch (e) { console.warn('pageInit', e) }
      }
    } catch (e) {
      console.error('bootPage', e)
      showMainApp()
    } finally {
      clearTimeout(safety)
      showMainApp()
    }
  }

    async function restartBot(botId) {
    if (!botId) throw new Error('Pilih bot dulu')
    return api('/bots/' + botId + '/restart', { method: 'POST', body: {}, timeoutMs: 30000 })
  }

  global.Zora = {
    $, $$, show, hide, escapeHtml, state, api, goToLogin,
    setLoading, showMainApp, bindShell, loadBots, fillBotSelect, bootPage, restartBot
  }
})(window)
