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
      bar.innerHTML = '<span>Plan: <strong>' + (limits.plan === 'premium' ? 'Premium' : 'Free') +
        '</strong></span> <span>Bot: <strong>' + limits.used + '</strong> / ' + limits.max + '</span>' +
        (limits.plan !== 'premium' ? ' <span style="color:#6b7280;font-size:0.85rem">Upgrade → max 3 bot</span>' : '')
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
        '<span class="badge ' + Z.escapeHtml(b.status) + '">' + Z.escapeHtml(b.status) + '</span>' +
        (b.plan === 'premium' ? '<span class="badge premium">Premium</span>' : '<span class="badge">Free</span>') +
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

  Z.bootPage(function () {
    if (Z.state.limits) limits = Z.state.limits
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
