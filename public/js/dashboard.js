(function () {
  'use strict'
  if (!window.Zora) {
    var t = document.getElementById('loading-text')
    if (t) t.textContent = 'Script gagal dimuat. Refresh halaman.'
    return
  }
  var Z = window.Zora
  var limits = { max: 1, used: 0, plan: 'free' }

  var ICO_BOT = '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2.5"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1.3"/><circle cx="15" cy="14" r="1.3"/></svg>'
  var ICO_PLAN = '<svg class="icon" viewBox="0 0 24 24"><path d="m3 17 2-9 5 4 2-6 2 6 5-4 2 9Z"/><path d="M5 21h14"/></svg>'
  var ICO_OK = '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>'
  var ICO_EMPTY = '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2.5"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1.3"/><circle cx="15" cy="14" r="1.3"/></svg>'

  function renderGreeting() {
    var el = Z.$('#greeting')
    if (!el) return
    var u = Z.state.user || {}
    var name = u.name || (u.email ? u.email.split('@')[0] : '')
    el.textContent = name ? ('Hi, ' + name + '!') : 'Selamat datang!'
  }

  function renderStats() {
    var bar = Z.$('#limits-bar')
    if (!bar) return
    var bots = Z.state.bots || []
    var connected = bots.filter(function (b) { return b.status === 'connected' }).length
    var isPremium = limits.plan === 'premium'
    bar.innerHTML =
      '<div class="stat-card' + (isPremium ? ' tone-gold' : '') + '">' +
        '<span class="stat-ico">' + ICO_PLAN + '</span>' +
        '<div><div class="stat-value">' + (isPremium ? 'Premium' : 'Free') + '</div><div class="stat-label">Paket Aktif</div></div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<span class="stat-ico">' + ICO_BOT + '</span>' +
        '<div><div class="stat-value">' + limits.used + ' / ' + limits.max + '</div><div class="stat-label">Bot Terpakai</div></div>' +
      '</div>' +
      '<div class="stat-card tone-ok">' +
        '<span class="stat-ico">' + ICO_OK + '</span>' +
        '<div><div class="stat-value">' + connected + '</div><div class="stat-label">Bot Terhubung</div></div>' +
      '</div>'
  }

  function renderPremiumCta() {
    var cta = Z.$('#premium-cta')
    if (!cta) return
    if (limits.plan === 'premium') cta.classList.add('hidden')
    else cta.classList.remove('hidden')
  }

  function renderBots() {
    var list = Z.$('#bots-list')
    if (!list) return
    renderStats()
    renderPremiumCta()
    var meta = Z.$('#bots-count-meta')
    if (meta) meta.textContent = limits.used + ' / ' + limits.max + ' bot'

    if (!Z.state.bots || !Z.state.bots.length) {
      list.innerHTML = '<div class="empty-state">' + ICO_EMPTY +
        '<p>Belum ada bot. Klik <strong>Buat Bot Baru</strong> untuk memulai.</p></div>'
      return
    }
    list.innerHTML = Z.state.bots.map(function (b) {
      var initial = Z.escapeHtml((b.botName || '?').trim().charAt(0) || '?')
      return '<div class="bot-card">' +
        '<div class="bot-card-main">' +
          '<div class="bot-avatar">' + initial + '</div>' +
          '<div style="min-width:0">' +
            '<h3>' + Z.escapeHtml(b.botName) + '</h3>' +
            '<div class="bot-meta"><span class="status-dot ' + Z.escapeHtml(b.status) + '"></span>' + Z.escapeHtml(b.sessionId) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bot-card-side">' +
          '<span class="badge ' + Z.escapeHtml(b.status) + '">' + Z.escapeHtml(b.status) + '</span>' +
          (b.plan === 'premium' ? '<span class="badge premium">Premium</span>' : '<span class="badge free">Free</span>') +
        '</div>' +
      '</div>'
    }).join('')
  }

  Z.bootPage(function () {
    if (Z.state.limits) limits = Z.state.limits
    renderGreeting()
    renderBots()
    var btn = Z.$('#create-bot-btn')
    if (!btn) return
    btn.onclick = async function () {
      if (limits.used >= limits.max) {
        alert(limits.plan === 'premium' ? 'Batas Premium: max 3 bot.' : 'Batas Free: max 1 bot. Upgrade Premium untuk 3 bot.')
        return
      }
      var name = prompt('Nama bot:', 'ZoraBot')
      if (name === null) return
      try {
        var res = await Z.api('/bots', { method: 'POST', body: { botName: name || 'ZoraBot' } })
        if (res.limits) limits = res.limits
        var data = await Z.api('/bots')
        Z.state.bots = data.bots || []
        limits = data.limits || limits
        renderBots()
      } catch (e) { alert(e.message) }
    }
  })
})()
