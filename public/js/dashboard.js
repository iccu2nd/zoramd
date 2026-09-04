(function () {
  'use strict'
  if (!window.Zora) {
    var t = document.getElementById('loading-text')
    if (t) t.textContent = 'Failed to load scripts. Please refresh.'
    return
  }
  var Z = window.Zora
  var limits = { max: 1, used: 0, plan: 'free' }
  var metricsTimer = null

  function fmtMs(ms) {
    if (ms == null || ms === 0) return '—'
    if (ms < 1000) return Math.round(ms) + ' ms'
    return (ms / 1000).toFixed(1) + ' s'
  }

  function renderMetrics(data) {
    var m = (data && data.metrics) || {}
    var set = function (id, v) {
      var el = Z.$(id)
      if (el) el.textContent = v
    }
    set('#m-in', m.messagesIn != null ? String(m.messagesIn) : '0')
    set('#m-out', m.messagesOut != null ? String(m.messagesOut) : '0')
    set('#m-cmds', m.commands != null ? String(m.commands) : '0')
    set('#m-okfail', (m.commandsOk || 0) + ' / ' + (m.commandsFail || 0))
    set('#m-users', m.activeUsers24h != null ? String(m.activeUsers24h) : '0')
    set('#m-rt', fmtMs(m.avgResponseMs))
    set('#m-err', (m.errorRate != null ? m.errorRate : 0) + '%')
    set('#m-plan', (data && data.plan === 'premium') ? 'Premium' : 'Free')

    var chart = Z.$('#cmd-chart')
    if (!chart) return
    var bots = (data && data.bots) || []
    var hours = {}
    bots.forEach(function (b) {
      var hourly = (b.metrics && b.metrics.hourly) || []
      hourly.forEach(function (h) {
        hours[h.t] = (hours[h.t] || 0) + (h.cmds || 0)
      })
    })
    var keys = Object.keys(hours).map(Number).sort(function (a, b) { return a - b }).slice(-24)
    if (!keys.length) {
      chart.innerHTML = '<p class="hint">No command activity yet. Metrics appear after the bot processes messages.</p>'
      return
    }
    var max = Math.max.apply(null, keys.map(function (k) { return hours[k] })) || 1
    chart.innerHTML = keys.map(function (k) {
      var h = Math.max(4, Math.round((hours[k] / max) * 64))
      return '<div class="bar" title="' + hours[k] + ' cmds" style="height:' + h + 'px"></div>'
    }).join('')
  }

  async function loadMetrics() {
    try {
      var data = await Z.api('/metrics', { timeoutMs: 8000 })
      renderMetrics(data)
    } catch (e) {
      /* non-fatal */
    }
  }

  function renderBots() {
    var list = Z.$('#bots-list')
    if (!list) return
    var bar = Z.$('#limits-bar')
    if (bar) {
      var plan = limits.plan === 'premium' ? 'Premium' : 'Free'
      var extras = limits.plan === 'premium'
        ? ' · no ads · custom identity · up to 3 bots · higher concurrency'
        : ' · max 1 bot · upgrade for 3 bots & premium features'
      bar.innerHTML = '<span>Plan: <strong>' + plan + '</strong></span>' +
        ' <span>Bots: <strong>' + limits.used + '</strong>/' + limits.max + '</span>' +
        '<span class="limits-extra">' + extras + '</span>'
    }
    if (!Z.state.bots || !Z.state.bots.length) {
      list.innerHTML = '<p class="hint">No bots yet. Create a bot to get started.</p>'
      return
    }
    list.innerHTML = Z.state.bots.map(function (b) {
      return '<div class="bot-card" data-id="' + Z.escapeHtml(b.id) + '">' +
        '<button type="button" class="bot-menu-btn" aria-label="Menu">&#8942;</button>' +
        '<div class="bot-menu-dropdown hidden">' +
          '<button type="button" data-act="settings">Bot settings</button>' +
          '<button type="button" data-act="restart">Restart</button>' +
          '<button type="button" data-act="power">' + (b.enabled !== false ? 'Disable' : 'Enable') + '</button>' +
          '<button type="button" class="danger" data-act="disconnect">Disconnect</button>' +
          '<button type="button" class="danger" data-act="delete">Delete bot</button>' +
        '</div>' +
        '<div><h3>' + Z.escapeHtml(b.botName) +
        '</h3><div class="bot-meta">' + Z.escapeHtml(b.sessionId) +
        '</div></div><div class="bot-card-status">' +
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
          if (act === 'restart') {
            await Z.restartBot(botId)
            Z.toast('Bot restarted successfully.', 'success')
          } else if (act === 'power') {
            var enable = btn.textContent === 'Enable'
            await Z.api('/bots/' + botId + '/power', { method: 'POST', body: { enabled: enable }, timeoutMs: 30000 })
            Z.toast(enable ? 'Bot enabled.' : 'Bot disabled.', 'success')
          } else if (act === 'disconnect') {
            if (!confirm('Disconnect this bot?')) return
            await Z.api('/bots/' + botId + '/disconnect', { method: 'POST' })
            Z.toast('Bot disconnected.', 'success')
          } else if (act === 'delete') {
            if (!confirm('Delete this bot? Session data and settings will be permanently removed.')) return
            await Z.api('/bots/' + botId, { method: 'DELETE' })
            Z.toast('Bot deleted.', 'success')
          }
          var data = await Z.api('/bots')
          Z.state.bots = data.bots || []
          limits = data.limits || limits
          renderBots()
          loadMetrics()
        } catch (e2) { Z.toast(e2.message, 'error') }
      }
    })
  }

  function closeAllMenus() {
    document.querySelectorAll('.bot-menu-dropdown').forEach(function (d) { d.classList.add('hidden') })
  }
  document.addEventListener('click', closeAllMenus)

  function setupOnboarding() {
    var box = Z.$('#onboarding')
    if (!box) return
    var bots = Z.state.bots || []
    var anyConnected = bots.some(function (b) { return b.status === 'connected' })
    var dismissed = localStorage.getItem('zora_onboard_v1') === '1'
    if (!dismissed && !anyConnected) {
      box.classList.remove('hidden')
      requestAnimationFrame(function () { box.classList.remove('is-closing') })
    } else box.classList.add('hidden')
    var btn = Z.$('#onboard-dismiss')
    if (btn) btn.onclick = function () {
      localStorage.setItem('zora_onboard_v1', '1')
      box.classList.add('is-closing')
      setTimeout(function () { box.classList.add('hidden') }, 220)
    }
  }

  Z.bootPage(function () {
    if (Z.state.limits) limits = Z.state.limits
    renderBots()
    setupOnboarding()
    loadMetrics()
    if (metricsTimer) clearInterval(metricsTimer)
    metricsTimer = setInterval(loadMetrics, 30000)

    var btn = Z.$('#create-bot-btn')
    if (!btn) return
    btn.onclick = async function () {
      if (limits.used >= limits.max) {
        Z.toast(limits.plan === 'premium'
          ? 'Premium limit: maximum 3 bots.'
          : 'Free limit: maximum 1 bot. Upgrade to Premium for 3 bots.', 'warning')
        return
      }
      var name = prompt('Bot name:', 'ZoraBot')
      if (name === null) return
      try {
        var res = await Z.api('/bots', { method: 'POST', body: { botName: name || 'ZoraBot' } })
        if (res.limits) limits = res.limits
        var data = await Z.api('/bots')
        Z.state.bots = data.bots || []
        limits = data.limits || limits
        renderBots()
        Z.toast('Bot created successfully.', 'success')
      } catch (e) { Z.toast(e.message, 'error') }
    }
  })
})()
