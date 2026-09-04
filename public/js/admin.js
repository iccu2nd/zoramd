(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  function esc(s) { return Z.escapeHtml(s) }
  function pageName() {
    return (document.body && document.body.getAttribute('data-page')) || 'admin'
  }
  function renderStats(st) {
    var stats = document.getElementById('admin-stats')
    if (!stats || !st) return
    stats.innerHTML =
      '<span>Users: <strong>' + (st.users || 0) + '</strong></span>' +
      '<span>Bots: <strong>' + (st.bots || 0) + '</strong></span>' +
      '<span>Connected: <strong>' + (st.connected || 0) + '</strong></span>' +
      '<span>Orders: <strong>' + (st.orders || 0) + '</strong></span>'
  }
  function renderPager(el, page, pages, onPage) {
    if (!el) return
    if (pages <= 1) { el.innerHTML = ''; return }
    el.innerHTML =
      '<button type="button" class="btn outline btn-sm" data-p="' + (page - 1) + '" ' + (page <= 1 ? 'disabled' : '') + '>Prev</button>' +
      '<span class="hint" style="margin:0">Page ' + page + ' / ' + pages + '</span>' +
      '<button type="button" class="btn outline btn-sm" data-p="' + (page + 1) + '" ' + (page >= pages ? 'disabled' : '') + '>Next</button>'
    el.querySelectorAll('button[data-p]').forEach(function (btn) {
      btn.onclick = function () {
        var p = Number(btn.getAttribute('data-p'))
        if (p >= 1 && p <= pages) onPage(p)
      }
    })
  }
  async function loadUsers(page) {
    var q = (document.getElementById('users-q') || {}).value || ''
    var role = (document.getElementById('users-role') || {}).value || ''
    var sort = (document.getElementById('users-sort') || {}).value || 'newest'
    var qs = '?page=' + (page || 1) + '&limit=20&sort=' + encodeURIComponent(sort)
    if (q) qs += '&q=' + encodeURIComponent(q)
    if (role) qs += '&role=' + encodeURIComponent(role)
    var data = await Z.api('/admin/users' + qs, { timeoutMs: 20000 })
    var usersEl = document.getElementById('admin-users')
    if (!usersEl) return
    usersEl.innerHTML = (data.accounts || []).map(function (a) {
      return '<div class="bot-card" data-id="' + esc(a.id) + '">' +
        '<button type="button" class="bot-menu-btn" aria-label="Menu">&#8942;</button>' +
        '<div class="bot-menu-dropdown hidden">' +
          '<button type="button" data-act="role" data-role="' + (a.role === 'admin' ? 'user' : 'admin') + '">' +
            (a.role === 'admin' ? 'Make user' : 'Make admin') + '</button>' +
          '<button type="button" class="danger" data-act="delete">Delete account</button>' +
        '</div>' +
        '<div><h3>' + esc(a.email || '(no email)') + '</h3>' +
        '<div class="bot-meta">' + esc(a.name || '') + ' · bots: ' + (a.botCount || 0) +
        ' · ' + (a.plan === 'premium' ? 'Premium' : 'Free') +
        (a.emailVerified ? ' · verified' : '') + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
        '<span class="badge ' + (a.role === 'admin' ? 'premium' : '') + '">' + esc(a.role || 'user') + '</span>' +
        '</div></div>'
    }).join('') || '<p class="hint">No users found.</p>'

    function closeMenus() {
      usersEl.querySelectorAll('.bot-menu-dropdown').forEach(function (d) { d.classList.add('hidden') })
    }
    usersEl.querySelectorAll('.bot-menu-btn').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation()
        var dd = btn.nextElementSibling
        var open = !dd.classList.contains('hidden')
        closeMenus()
        if (!open) dd.classList.remove('hidden')
      }
    })
    usersEl.querySelectorAll('.bot-menu-dropdown button').forEach(function (btn) {
      btn.onclick = async function (e) {
        e.stopPropagation()
        var card = btn.closest('.bot-card')
        var id = card && card.dataset.id
        var act = btn.dataset.act
        closeMenus()
        if (!id) return
        try {
          if (act === 'role') {
            await Z.api('/admin/accounts/' + id + '/role', { method: 'POST', body: { role: btn.dataset.role } })
            Z.toast('Role updated successfully.', 'success')
            loadUsers(data.page)
          } else if (act === 'delete') {
            if (!confirm('Permanently delete this account and all of its bots?')) return
            await Z.api('/admin/accounts/' + id, { method: 'DELETE' })
            Z.toast('Account deleted successfully.', 'success')
            loadUsers(data.page)
          }
        } catch (err) { Z.toast(err.message, 'error') }
      }
    })
    document.addEventListener('click', closeMenus)
    renderPager(document.getElementById('users-pager'), data.page, data.pages, loadUsers)
  }

async function loadBots(page) {
    var data = await Z.api('/admin/bots?page=' + (page || 1) + '&limit=20&sort=newest', { timeoutMs: 20000 })
    var botsEl = document.getElementById('admin-bots')
    if (!botsEl) return
    botsEl.innerHTML = (data.bots || []).map(function (b) {
      var wa = b.waNumber ? ('+' + String(b.waNumber).replace(/^\+/, '')) : 'Not linked'
      var st = b.statusLabel || b.status || 'disconnected'
      return '<div class="bot-card" data-id="' + esc(b.id) + '" data-session="' + esc(b.sessionId || '') + '">' +
        '<button type="button" class="bot-menu-btn" aria-label="Menu">&#8942;</button>' +
        '<div class="bot-menu-dropdown hidden">' +
          '<button type="button" data-act="settings">Settings</button>' +
          '<button type="button" data-act="premium">+1 month Premium</button>' +
          '<button type="button" data-act="stop">Stop</button>' +
          '<button type="button" class="danger" data-act="delete">Delete</button>' +
        '</div>' +
        '<div><h3>' + esc(b.botName || 'Bot') + '</h3>' +
        '<div class="bot-meta">WA: <strong>' + esc(wa) + '</strong>' +
          (b.waName ? (' · ' + esc(b.waName)) : '') + '</div>' +
        '<div class="bot-meta">Session: ' + esc(b.sessionId || '') +
          ' · owner ' + esc(b.ownerId || '-') + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
        '<span class="badge ' + esc(b.status || '') + '">' + esc(st) + '</span>' +
        '<button type="button" class="btn outline btn-sm admin-bot-settings" data-id="' + esc(b.id) + '">Settings</button>' +
        '</div></div>'
    }).join('') || '<p class="hint">No bots found.</p>'

    function closeMenus() {
      botsEl.querySelectorAll('.bot-menu-dropdown').forEach(function (d) { d.classList.add('hidden') })
    }
    botsEl.querySelectorAll('.bot-menu-btn').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation()
        var dd = btn.nextElementSibling
        var open = !dd.classList.contains('hidden')
        closeMenus()
        if (!open) dd.classList.remove('hidden')
      }
    })
    document.addEventListener('click', closeMenus)

    async function openSettings(botId) {
      var panel = document.getElementById('admin-bot-settings-panel')
      var body = document.getElementById('admin-bot-settings-body')
      if (!panel || !body) {
        Z.toast('Settings panel not available.', 'error')
        return
      }
      body.innerHTML = '<p class="hint">Loading settings...</p>'
      panel.classList.remove('hidden')
      try {
        var data = await Z.api('/admin/bots/' + encodeURIComponent(botId) + '/settings', { timeoutMs: 15000 })
        var bot = data.bot || {}
        var settings = data.settings || {}
        // Strip internal Mongo fields for display
        var clean = {}
        Object.keys(settings).forEach(function (k) {
          if (k === '_id' || k === 'botId') return
          clean[k] = settings[k]
        })
        var wa = bot.waNumber ? ('+' + String(bot.waNumber).replace(/^\+/, '')) : 'Not linked'
        body.innerHTML =
          '<div class="bot-meta" style="margin-bottom:12px">' +
            '<div><strong>' + esc(bot.botName || '') + '</strong></div>' +
            '<div>WhatsApp: <strong>' + esc(wa) + '</strong>' + (bot.waName ? (' · ' + esc(bot.waName)) : '') + '</div>' +
            '<div>Status: ' + esc(bot.statusLabel || bot.status || '-') + '</div>' +
            '<div>Session: ' + esc(bot.sessionId || '') + '</div>' +
            '<div>Owner account: ' + esc(bot.ownerId || '-') + '</div>' +
            (bot.ownerNumber ? ('<div class="hint">Owner number (account): ' + esc(bot.ownerNumber) + '</div>') : '') +
          '</div>' +
          '<h3 style="margin:12px 0 8px">Stored settings</h3>' +
          (Object.keys(clean).length
            ? '<pre class="settings-pre" style="white-space:pre-wrap;word-break:break-word;background:var(--bg-soft);padding:12px;border-radius:12px;font-size:0.82rem;max-height:360px;overflow:auto">' +
                esc(JSON.stringify(clean, null, 2)) + '</pre>'
            : '<p class="hint">No custom settings saved for this bot yet (defaults apply).</p>')
      } catch (e) {
        body.innerHTML = '<p class="error">' + esc(e.message) + '</p>'
      }
    }

    botsEl.querySelectorAll('.admin-bot-settings').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation()
        openSettings(btn.dataset.id)
      }
    })
    botsEl.querySelectorAll('.bot-menu-dropdown button').forEach(function (btn) {
      btn.onclick = async function (e) {
        e.stopPropagation()
        var card = btn.closest('.bot-card')
        var id = card && card.dataset.id
        var act = btn.dataset.act
        closeMenus()
        if (!id) return
        try {
          if (act === 'settings') {
            openSettings(id)
          } else if (act === 'premium') {
            await Z.api('/admin/bots/' + id + '/premium', { method: 'POST', body: { months: 1 } })
            Z.toast('Premium activated for 1 month.', 'success')
          } else if (act === 'stop') {
            await Z.api('/admin/bots/' + id + '/status', { method: 'POST', body: { action: 'stop' } })
            Z.toast('Bot stopped successfully.', 'success')
            loadBots(data.page)
          } else if (act === 'delete') {
            if (!confirm('Permanently delete this bot?')) return
            await Z.api('/admin/bots/' + id, { method: 'DELETE' })
            Z.toast('Bot deleted successfully.', 'success')
            loadBots(data.page)
          }
        } catch (err) { Z.toast(err.message, 'error') }
      }
    })
  }

async function loadErrors(page) {
    var q = (document.getElementById('errors-q') || {}).value || ''
    var botId = (document.getElementById('errors-bot') || {}).value || ''
    var qs = '?page=' + (page || 1) + '&limit=20'
    if (q) qs += '&q=' + encodeURIComponent(q)
    if (botId) qs += '&botId=' + encodeURIComponent(botId)
    var data = await Z.api('/admin/errors' + qs, { timeoutMs: 20000 })
    var el = document.getElementById('admin-errors')
    if (!el) return
    el.innerHTML = (data.errors || []).map(function (e) {
      var when = e.createdAt ? new Date(e.createdAt).toLocaleString() : ''
      return '<div class="bot-card"><div><h3>' + esc(e.cmd || '(unknown)') + '</h3>' +
        '<div class="bot-meta">' + esc(when) + ' · ' + esc(e.botId || e.sessionId || '') + '</div>' +
        '<p class="hint" style="margin:6px 0 0">' + esc(e.message || '') + '</p></div></div>'
    }).join('') || '<p class="hint">No errors found.</p>'
    renderPager(document.getElementById('errors-pager'), data.page, data.pages, loadErrors)
  }
  function renderOrders(orders) {
    var ordersEl = document.getElementById('admin-orders')
    if (!ordersEl) return
    ordersEl.innerHTML = (orders || []).map(function (o) {
      return '<div class="bot-card"><div><h3>' + esc(o.orderId) + '</h3>' +
        '<div class="bot-meta">Rp' + Number(o.amount || 0).toLocaleString('en-US') +
        ' · bot ' + esc(o.botId) + '</div></div><span class="badge">' + esc(o.status) + '</span></div>'
    }).join('') || '<p class="hint">No orders yet.</p>'
  }
  function fillAdsTarget(bots) {
    var targetSel = document.getElementById('admin-ads-target')
    if (!targetSel) return
    var connectedBots = (bots || []).filter(function (b) { return b.status === 'connected' })
    targetSel.innerHTML = '<option value="all">All connected bots</option>' +
      connectedBots.map(function (b) {
        return '<option value="' + esc(b.sessionId) + '">' + esc(b.botName || b.sessionId) + '</option>'
      }).join('')
  }
  function bindAdsSettings() {
    var saveAds = document.getElementById('admin-ads-save')
    if (saveAds) {
      saveAds.onclick = async function () {
        var msg = document.getElementById('admin-ads-msg')
        try {
          await Z.api('/admin/platform', {
            method: 'PUT',
            body: {
              freeAdsEnabled: document.getElementById('admin-free-ads').checked,
              adsText: document.getElementById('admin-ads-text').value
            }
          })
          if (msg) { msg.textContent = 'Saved'; msg.className = 'msg ok' }
          Z.toast('Ad settings saved successfully.', 'success')
        } catch (e) {
          if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
        }
      }
    }
    Z.api('/admin/platform').then(function (plat) {
      var s = plat.settings || {}
      var adsEl = document.getElementById('admin-free-ads')
      if (adsEl) adsEl.checked = s.freeAdsEnabled !== false
      var adsTx = document.getElementById('admin-ads-text')
      if (adsTx) adsTx.value = s.adsText || ''
    }).catch(function () {})
    var sendAds = document.getElementById('admin-ads-send')
    if (!sendAds) return
    sendAds.onclick = async function () {
      var msg = document.getElementById('admin-ads-send-msg')
      var resultEl = document.getElementById('admin-ads-send-result')
      var progressText = document.getElementById('admin-ads-progress-text')
      var manualTextEl = document.getElementById('admin-ads-manual-text')
      var defaultTextEl = document.getElementById('admin-ads-text')
      var targetEl = document.getElementById('admin-ads-target')
      var skipPremiumEl = document.getElementById('admin-ads-skip-premium')
      var text = ((manualTextEl && manualTextEl.value.trim()) || (defaultTextEl && defaultTextEl.value.trim()) || '')
      if (!text) {
        if (msg) { msg.textContent = 'Enter ad text first.'; msg.className = 'msg err' }
        Z.toast('Enter ad text first.', 'warning')
        return
      }
      var target = (targetEl && targetEl.value) || 'all'
      var skipPremium = skipPremiumEl ? skipPremiumEl.checked : true
      sendAds.disabled = true
      try {
        var data = await Z.api('/admin/ads/send', {
          method: 'POST',
          body: { target: target, text: text, skipPremium: skipPremium },
          timeoutMs: 120000
        })
        var total = (data.results || []).reduce(function (a, r) { return a + (r.sent || 0) }, 0)
        if (msg) { msg.textContent = 'Done. Sent to ' + total + ' groups.'; msg.className = 'msg ok' }
        if (resultEl) {
          resultEl.innerHTML = (data.results || []).map(function (r) {
            var status = r.error ? ('Failed: ' + esc(r.error)) : (r.skipped ? 'Skipped (premium)' : (r.sent + ' groups'))
            return '<div class="bot-card"><div><h3>' + esc(r.botName || r.sessionId) + '</h3></div><span class="badge">' + status + '</span></div>'
          }).join('')
        }
        Z.toast('Ads sent successfully.', 'success')
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
        Z.toast(e.message, 'error')
      } finally {
        sendAds.disabled = false
        if (progressText) progressText.textContent = ''
      }
    }
  }
  Z.bootPage(async function () {
    try {
      var me = await Z.api('/auth/me', { timeoutMs: 8000 })
      Z.state.user = me.user
      if (!me.user || !me.user.isAdmin) {
        Z.toast('This page is restricted to admins.', 'error')
        location.replace('/dashboard')
        return
      }
    } catch (e) {
      if (e.status === 401) return
      Z.toast('Failed to verify admin access.', 'error')
      location.replace('/dashboard')
      return
    }
    var page = pageName()
    try {
      if (page === 'admin' || page === 'admin-users' || page === 'admin-bots' || page === 'admin-ads') {
        var overview = await Z.api('/admin/overview', { timeoutMs: 20000 })
        renderStats(overview.stats)
        if (page === 'admin') renderOrders(overview.orders)
      }
      if (page === 'admin-users') {
        var debounceTimer = null
        function scheduleSearch() {
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(function () { loadUsers(1) }, 350)
        }
        ;['users-q', 'users-role', 'users-sort'].forEach(function (id) {
          var el = document.getElementById(id)
          if (!el) return
          el.addEventListener(id === 'users-q' ? 'input' : 'change', scheduleSearch)
        })
        await loadUsers(1)
      }
      if (page === 'admin-bots') await loadBots(1)
      if (page === 'admin-errors') {
        var es = document.getElementById('errors-search')
        if (es) es.onclick = function () { loadErrors(1) }
        await loadErrors(1)
      }
      if (page === 'admin-ads') {
        var botsData = await Z.api('/admin/bots?page=1&limit=50&status=connected', { timeoutMs: 20000 }).catch(function () { return { bots: [] } })
        fillAdsTarget(botsData.bots)
        bindAdsSettings()
      }
    } catch (e) {
      Z.toast(e.message || 'Failed to load admin.', 'error')
      if (e.status === 403 || e.status === 404) location.replace('/dashboard')
    }
  })
})()
