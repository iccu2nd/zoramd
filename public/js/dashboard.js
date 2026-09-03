(function () {
  'use strict'
  if (!window.Zora) {
    var t = document.getElementById('loading-text')
    if (t) t.textContent = 'Script gagal dimuat. Refresh halaman.'
    return
  }
  var Z = window.Zora
  var limits = { max: 1, used: 0, plan: 'free' }

  function renderBots() {
    var list = Z.$('#bots-list')
    if (!list) return
    var bar = Z.$('#limits-bar')
    if (bar) {
      var plan = limits.plan === 'premium' ? 'Premium' : 'Free'
      var extras = limits.plan === 'premium'
        ? ' · tanpa iklan · identity custom · max 3 bot'
        : ' · max 1 bot · Upgrade untuk 3 bot & identity'
      bar.innerHTML = '<span>Plan: <strong>' + plan + '</strong></span>' +
        ' <span>Bot: <strong>' + limits.used + '</strong>/' + limits.max + '</span>' +
        '<span class="limits-extra">' + extras + '</span>'
    }
    if (!Z.state.bots || !Z.state.bots.length) {
      list.innerHTML = '<p class="hint">Belum ada bot. Buat bot baru untuk memulai.</p>'
      return
    }
    list.innerHTML = Z.state.bots.map(function (b) {
      return '<div class="bot-card" data-id="' + Z.escapeHtml(b.id) + '">' +
        '<button type="button" class="bot-menu-btn" aria-label="Menu">&#8942;</button>' +
        '<div class="bot-menu-dropdown hidden">' +
          '<button type="button" data-act="settings">Pengaturan Bot</button>' +
          '<button type="button" data-act="restart">Restart</button>' +
          '<button type="button" data-act="power">' + (b.enabled !== false ? 'Matikan' : 'Nyalakan') + '</button>' +
          '<button type="button" class="danger" data-act="disconnect">Putuskan Koneksi</button>' +
          '<button type="button" class="danger" data-act="delete">Hapus Bot</button>' +
        '</div>' +
        '<div><h3>' + Z.escapeHtml(b.botName) +
        '</h3><div class="bot-meta">' + Z.escapeHtml(b.sessionId) +
        '</div></div><div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px">' +
        '<span class="badge ' + Z.escapeHtml(b.status) + '" title="' + Z.escapeHtml(b.lastError || '') + '">' +
          Z.escapeHtml(b.statusLabel || b.status) + '</span>' +
        (b.plan === 'premium' ? '<span class="badge premium">Premium</span>' : '<span class="badge">Free</span>') +
        (b.lastError ? '<div class="bot-error">' + Z.escapeHtml(b.lastError) + '</div>' : '') +
        '</div></div>'
    }).join('')
    closeAllMenus()
    list.querySelectorAll('.bot-menu-btn').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation()
        var dd = btn.nextElementSibling
        var open = !dd.classList.contains('hidden')
        closeAllMenus()
        if (!open) dd.classList.remove('hidden')
      }
    })
    list.querySelectorAll('.bot-menu-dropdown button').forEach(function (btn) {
      btn.onclick = async function (e) {
        e.stopPropagation()
        var botId = btn.closest('.bot-card').dataset.id
        var act = btn.dataset.act
        closeAllMenus()
        if (act === 'settings') { location.href = '/bot-settings'; return }
        try {
          if (act === 'restart') { await Z.restartBot(botId); alert('Bot di-restart') }
          else if (act === 'power') {
            var enable = btn.textContent === 'Nyalakan'
            await Z.api('/bots/' + botId + '/power', { method: 'POST', body: { enabled: enable }, timeoutMs: 30000 })
          } else if (act === 'disconnect') {
            if (!confirm('Putuskan koneksi bot ini?')) return
            await Z.api('/bots/' + botId + '/disconnect', { method: 'POST' })
          } else if (act === 'delete') {
            if (!confirm('Hapus bot ini? Semua data, sesi, dan pengaturan bot akan hilang permanen.')) return
            await Z.api('/bots/' + botId, { method: 'DELETE' })
          }
          var data = await Z.api('/bots')
          Z.state.bots = data.bots || []
          limits = data.limits || limits
          renderBots()
        } catch (e2) { alert(e2.message) }
      }
    })
  }

  function closeAllMenus() {
    document.querySelectorAll('.bot-menu-dropdown').forEach(function (d) { d.classList.add('hidden') })
  }
  document.addEventListener('click', closeAllMenus)

  function loadErrors() {
    var sel = Z.$('#err-bot-select')
    var list = Z.$('#err-list')
    if (!sel || !list) return
    var botId = sel.value
    if (!botId) { list.innerHTML = '<p class="hint">Pilih bot</p>'; return }
    list.innerHTML = '<p class="hint">Memuat...</p>'
    Z.api('/bots/' + botId + '/errors', { timeoutMs: 10000 }).then(function (data) {
      var items = data.errors || []
      if (!items.length) { list.innerHTML = '<p class="hint">Belum ada error tercatat.</p>'; return }
      list.innerHTML = items.map(function (e) {
        var t = e.createdAt ? new Date(e.createdAt).toLocaleString('id-ID') : ''
        return '<div class="err-item"><strong>.' + Z.escapeHtml(e.cmd || '?') + '</strong> · ' +
          Z.escapeHtml(t) + '<div class="err-msg">' + Z.escapeHtml(e.message || '') + '</div></div>'
      }).join('')
    }).catch(function (e) {
      list.innerHTML = '<p class="error">' + Z.escapeHtml(e.message) + '</p>'
    })
  }

  function setupOnboarding() {
    var box = Z.$('#onboarding')
    if (!box) return
    var bots = Z.state.bots || []
    var anyConnected = bots.some(function (b) { return b.status === 'connected' })
    var dismissed = localStorage.getItem('zora_onboard_v1') === '1'
    if (!dismissed && !anyConnected) box.classList.remove('hidden')
    else box.classList.add('hidden')
    var btn = Z.$('#onboard-dismiss')
    if (btn) btn.onclick = function () {
      localStorage.setItem('zora_onboard_v1', '1')
      box.classList.add('hidden')
    }
  }

  Z.bootPage(function () {
    if (Z.state.limits) limits = Z.state.limits
    renderBots()
    setupOnboarding()
    Z.fillBotSelect('err-bot-select')
    loadErrors()
    var es = Z.$('#err-bot-select')
    if (es) es.onchange = loadErrors
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
