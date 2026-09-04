/* ZoraBot shared client — fast boot */
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

  var toastTitles = {
    success: 'Berhasil',
    error: 'Terjadi kesalahan',
    warning: 'Perhatian',
    info: 'Informasi'
  }

  function ensureToastContainer() {
    var existing = document.getElementById('toast-container')
    if (existing) return existing
    var container = document.createElement('div')
    container.id = 'toast-container'
    container.className = 'toast-container'
    container.setAttribute('aria-live', 'polite')
    container.setAttribute('aria-atomic', 'false')
    document.body.appendChild(container)
    return container
  }

  function toast(message, type, title) {
    var kind = toastTitles[type] ? type : 'info'
    var container = ensureToastContainer()
    var item = document.createElement('div')
    var icon = {
      success: 'fa-circle-check',
      error: 'fa-circle-exclamation',
      warning: 'fa-triangle-exclamation',
      info: 'fa-circle-info'
    }[kind]
    var close = document.createElement('button')
    var timer = null
    var dismissTimer = null

    item.className = 'toast toast-' + kind
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    item.innerHTML =
      '<span class="toast-icon" aria-hidden="true"><i class="fa-solid ' + icon + '"></i></span>' +
      '<span class="toast-copy"><strong>' + escapeHtml(title || toastTitles[kind]) + '</strong>' +
      '<span>' + escapeHtml(message || '') + '</span></span>'

    close.type = 'button'
    close.className = 'toast-close'
    close.setAttribute('aria-label', 'Tutup notifikasi')
    close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
    item.appendChild(close)

    function dismiss() {
      if (dismissTimer) return
      if (timer) clearTimeout(timer)
      item.classList.add('is-leaving')
      dismissTimer = setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item)
      }, 220)
    }

    close.onclick = dismiss
    container.appendChild(item)
    timer = setTimeout(dismiss, 4000)
    return { close: dismiss }
  }

  var state = {
    user: null,
    bots: [],
    limits: null
  }
  var inflightGets = new Map()
  function getStoredToken() {
    try { return sessionStorage.getItem('zora_token') || localStorage.getItem('zora_token') || '' } catch (e) { return '' }
  }
  function setStoredToken(token) {
    try {
      if (token) {
        sessionStorage.setItem('zora_token', token)
        localStorage.setItem('zora_token', token)
      } else {
        sessionStorage.removeItem('zora_token')
        localStorage.removeItem('zora_token')
      }
    } catch (e) {}
  }
  function clearSessionCache() {
    state.user = null
    try {
      localStorage.removeItem('zora_user')
      localStorage.removeItem('zora_bots')
      setStoredToken('')
    } catch (e) {}
  }

  try {
    var cu = localStorage.getItem('zora_user')
    if (cu) state.user = JSON.parse(cu)
  } catch (e) {}
  try {
    var cb = localStorage.getItem('zora_bots')
    if (cb) {
      var parsed = JSON.parse(cb)
      state.bots = parsed.bots || []
      state.limits = parsed.limits || null
    }
  } catch (e) {}

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false
      var t = setTimeout(function () {
        if (done) return
        done = true
        var err = new Error((label || 'Request') + ' timeout')
        err.status = 408
        reject(err)
      }, ms || 10000)
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
    var method = (opts.method || 'GET').toUpperCase()
    var dedupe = method === 'GET' && opts.dedupe !== false
    var key = path + '|' + String(opts.timeoutMs || 10000)
    if (dedupe && inflightGets.has(key)) return inflightGets.get(key)

    var request = (async function () {
      var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
      var stored = getStoredToken()
      if (stored && !headers.Authorization) headers.Authorization = 'Bearer ' + stored
      var fetchOpts = {
        method: method,
        headers: headers,
        credentials: 'include'
      }
      if (opts.body != null) fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
      var res = await withTimeout(fetch('/api' + path, fetchOpts), opts.timeoutMs || 10000, path)
      var data = {}
      try { data = await res.json() } catch (e) {}
      if (res.status === 401) {
        clearSessionCache()
        var err = new Error(data.error || 'Unauthorized')
        err.status = 401
        throw err
      }
      if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed')
      return data
    })()
    if (dedupe) {
      inflightGets.set(key, request)
      request.then(function () { if (inflightGets.get(key) === request) inflightGets.delete(key) },
        function () { if (inflightGets.get(key) === request) inflightGets.delete(key) })
    }
    return request
  }

  function goToLogin(reason) {
    try {
      if (reason) sessionStorage.setItem('zora_login_reason', reason)
      var next = location.pathname + location.search
      if (next && next.indexOf('/login') !== 0) sessionStorage.setItem('zora_login_next', next)
    } catch (e) {}
    location.replace('/login')
  }

  function setLoading(on) {
    var lv = document.getElementById('loading-view')
    var mv = document.getElementById('main-view')
    if (on) {
      if (lv) { lv.classList.remove('hidden'); lv.style.display = '' }
      if (mv) { mv.classList.add('hidden') }
    } else {
      if (lv) { lv.classList.add('hidden'); lv.style.display = 'none' }
      if (mv) { mv.classList.remove('hidden'); mv.style.display = '' }
    }
  }

  function showMainApp() {
    setLoading(false)
  }


  function ensureSiteFooter() {
    if (document.getElementById('site-footer')) return
    var year = new Date().getFullYear()
    var foot = document.createElement('footer')
    foot.id = 'site-footer'
    foot.className = 'site-footer'
    foot.innerHTML =
      '<div class="site-footer-links">' +
        '<a href="/terms" target="_blank" rel="noopener">Syarat &amp; Ketentuan</a>' +
        '<span class="site-footer-sep">|</span>' +
        '<a href="/privacy" target="_blank" rel="noopener">Kebijakan Privasi</a>' +
        '<span class="site-footer-sep">|</span>' +
        '<a href="/upgrade">Premium</a>' +
        '<span class="site-footer-sep">|</span>' +
        '<a href="https://t.me/reyzxdv" target="_blank" rel="noopener">CS Telegram</a>' +
      '</div>' +
      '<p class="site-footer-copy">&copy; ' + year + ' ZoraBot. All rights reserved.</p>'
    // Tempel di #main-view agar sticky di bawah viewport
    var root = document.getElementById('main-view') || document.body
    root.appendChild(foot)
  }


  function setupNotifications() {
    var chip = document.getElementById('user-chip')
    var top = document.querySelector('.topbar')
    if (!top || document.getElementById('notif-wrap')) return
    var wrap = document.createElement('div')
    wrap.className = 'notif-wrap'
    wrap.id = 'notif-wrap'
    wrap.innerHTML =
      '<button type="button" class="notif-btn" id="notif-btn" aria-label="Notifikasi">' +
      '<i class="fa-regular fa-bell"></i><span class="notif-dot" id="notif-dot"></span></button>' +
      '<div class="notif-panel hidden" id="notif-panel"><div class="notif-empty">Memuat...</div></div>'
    // place before user-chip
    if (chip && chip.parentNode) chip.parentNode.insertBefore(wrap, chip)
    else top.appendChild(wrap)

    var btn = document.getElementById('notif-btn')
    var panel = document.getElementById('notif-panel')
    var dot = document.getElementById('notif-dot')

    async function refresh() {
      try {
        var data = await api('/notifications', { timeoutMs: 8000 })
        var items = data.notifications || []
        if (dot) {
          if (data.unread > 0) dot.classList.add('show')
          else dot.classList.remove('show')
        }
        if (!panel) return
        if (!items.length) {
          panel.innerHTML = '<div class="notif-empty">Tidak ada notifikasi</div>'
          return
        }
        panel.innerHTML = items.map(function (n) {
          return '<div class="notif-item' + (n.read ? '' : ' unread') + '" data-id="' + escapeHtml(n.id) + '" data-link="' + escapeHtml(n.link || '') + '">' +
            '<strong>' + escapeHtml(n.title || '') + '</strong>' +
            '<span>' + escapeHtml(n.body || '') + '</span></div>'
        }).join('')
        panel.querySelectorAll('.notif-item').forEach(function (el) {
          el.onclick = async function () {
            try { await api('/notifications/read', { method: 'POST', body: { ids: [el.dataset.id] } }) } catch (e) {}
            if (el.dataset.link) location.href = el.dataset.link
            else refresh()
          }
        })
      } catch (e) {
        if (panel) panel.innerHTML = '<div class="notif-empty">Gagal memuat</div>'
      }
    }

    if (btn && panel) {
      btn.onclick = function (e) {
        e.stopPropagation()
        panel.classList.toggle('hidden')
        if (!panel.classList.contains('hidden')) refresh()
      }
      document.addEventListener('click', function () { panel.classList.add('hidden') })
      panel.addEventListener('click', function (e) { e.stopPropagation() })
      // initial badge
      api('/notifications', { timeoutMs: 8000 }).then(function (data) {
        if (dot && data.unread > 0) dot.classList.add('show')
      }).catch(function () {})
    }
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
        api('/auth/logout', { method: 'POST', body: {} }).catch(function () {})
        clearSessionCache()
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
    try {
      localStorage.setItem('zora_bots', JSON.stringify({ bots: state.bots, limits: state.limits }))
    } catch (e) {}
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

  /**
   * Fast boot: tampilkan UI langsung (pakai cache), refresh data di background.
   * Tidak menunggu network untuk hide loading.
   */
  async function bootPage(pageInit) {
    bindShell()
    ensureSiteFooter()
    ensureToastContainer()
    try { setupNotifications() } catch (e) {}

    // Cookie HttpOnly diverifikasi lebih dulu supaya halaman tidak memproses
    // data cache sebelum sesi server dipastikan valid.
    try {
      var me = await api('/auth/me', { timeoutMs: 8000 })
      state.user = me.user
      if (me.token) setStoredToken(me.token)
      try { localStorage.setItem('zora_user', JSON.stringify(me.user)) } catch (e) {}
      var navAd = document.getElementById('nav-admin')
      if (navAd && me.user && me.user.isAdmin) navAd.classList.remove('hidden')
    } catch (e) {
      if (e.status === 401) {
        goToLogin('session')
        return
      }
    }

    showMainApp()
    if (typeof pageInit === 'function') {
      try { await pageInit() } catch (e) { console.warn('pageInit', e) }
    }

    try {
      await loadBots()
    } catch (e) {
      if (e.status === 401) goToLogin('session')
    }
  }

  async function restartBot(botId) {
    if (!botId) throw new Error('Pilih bot dulu')
    return api('/bots/' + botId + '/restart', { method: 'POST', body: {}, timeoutMs: 30000 })
  }

  global.Zora = {
    $, $$, show, hide, escapeHtml, toast, state, api, goToLogin,
    setLoading, showMainApp, bindShell, ensureSiteFooter, loadBots, fillBotSelect, bootPage, restartBot,
    getStoredToken, setStoredToken, clearSessionCache
  }
})(window)
