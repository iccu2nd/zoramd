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

  function renderUsers(accounts) {
    var usersEl = document.getElementById('admin-users')
    if (!usersEl) return
    usersEl.innerHTML = (accounts || []).map(function (a) {
      return '<div class="bot-card"><div><h3>' + esc(a.email) + '</h3>' +
        '<div class="bot-meta">' + esc(a.name) + ' · ' + esc(a.id) + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
        '<span class="badge ' + (a.role === 'admin' ? 'premium' : '') + '">' + esc(a.role || 'user') + '</span>' +
        '<button type="button" class="btn outline btn-sm admin-role" data-id="' + esc(a.id) + '" data-role="' +
        (a.role === 'admin' ? 'user' : 'admin') + '">' +
        (a.role === 'admin' ? 'Jadikan user' : 'Jadikan admin') + '</button></div></div>'
    }).join('') || '<p class="hint">Tidak ada user</p>'

    usersEl.querySelectorAll('.admin-role').forEach(function (btn) {
      btn.onclick = async function () {
        try {
          await Z.api('/admin/accounts/' + btn.dataset.id + '/role', {
            method: 'POST', body: { role: btn.dataset.role }
          })
          location.reload()
        } catch (e) { alert(e.message) }
      }
    })
  }

  function renderBots(bots) {
    var botsEl = document.getElementById('admin-bots')
    if (!botsEl) return
    botsEl.innerHTML = (bots || []).map(function (b) {
      return '<div class="bot-card"><div><h3>' + esc(b.botName) + '</h3>' +
        '<div class="bot-meta">' + esc(b.sessionId) + ' · owner ' + esc(b.ownerId) + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
        '<span class="badge ' + esc(b.status || '') + '">' + esc(b.status || '-') + '</span>' +
        '<button type="button" class="btn outline admin-prem" data-id="' + esc(b.id) + '">+ Premium 1bln</button>' +
        '<button type="button" class="btn outline admin-stop" data-id="' + esc(b.id) + '">Stop</button>' +
        '<button type="button" class="btn danger admin-del" data-id="' + esc(b.id) + '">Hapus</button>' +
        '</div></div>'
    }).join('') || '<p class="hint">Tidak ada bot</p>'

    botsEl.querySelectorAll('.admin-prem').forEach(function (btn) {
      btn.onclick = async function () {
        try {
          await Z.api('/admin/bots/' + btn.dataset.id + '/premium', { method: 'POST', body: { months: 1 } })
          alert('Premium diaktifkan 1 bulan')
        } catch (e) { alert(e.message) }
      }
    })
    botsEl.querySelectorAll('.admin-stop').forEach(function (btn) {
      btn.onclick = async function () {
        try {
          await Z.api('/admin/bots/' + btn.dataset.id + '/status', { method: 'POST', body: { action: 'stop' } })
          alert('Bot di-stop')
          location.reload()
        } catch (e) { alert(e.message) }
      }
    })
    botsEl.querySelectorAll('.admin-del').forEach(function (btn) {
      btn.onclick = async function () {
        if (!confirm('Hapus bot ini permanen?')) return
        try {
          await Z.api('/admin/bots/' + btn.dataset.id, { method: 'DELETE' })
          location.reload()
        } catch (e) { alert(e.message) }
      }
    })
  }

  function renderOrders(orders) {
    var ordersEl = document.getElementById('admin-orders')
    if (!ordersEl) return
    ordersEl.innerHTML = (orders || []).map(function (o) {
      return '<div class="bot-card"><div><h3>' + esc(o.orderId) + '</h3>' +
        '<div class="bot-meta">Rp' + Number(o.amount || 0).toLocaleString('id-ID') +
        ' · bot ' + esc(o.botId) + '</div></div>' +
        '<span class="badge">' + esc(o.status) + '</span></div>'
    }).join('') || '<p class="hint">Tidak ada order</p>'
  }

  function fillAdsTarget(bots) {
    var targetSel = document.getElementById('admin-ads-target')
    if (!targetSel) return
    var connectedBots = (bots || []).filter(function (b) { return b.status === 'connected' })
    targetSel.innerHTML = '<option value="all">Semua Bot (connected)</option>' +
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
          if (msg) { msg.textContent = 'Tersimpan'; msg.className = 'msg ok' }
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
      var progressWrap = document.getElementById('admin-ads-progress')
      var progressBar = document.getElementById('admin-ads-progress-bar')
      var progressText = document.getElementById('admin-ads-progress-text')
      var manualTextEl = document.getElementById('admin-ads-manual-text')
      var defaultTextEl = document.getElementById('admin-ads-text')
      var targetEl = document.getElementById('admin-ads-target')
      var skipPremiumEl = document.getElementById('admin-ads-skip-premium')

      var manualText = manualTextEl ? manualTextEl.value.trim() : ''
      var defaultText = defaultTextEl ? defaultTextEl.value.trim() : ''
      var text = manualText || defaultText
      if (!text) {
        if (msg) { msg.textContent = 'Isi teks iklan dulu (manual atau default).'; msg.className = 'msg err' }
        alert('Isi teks iklan dulu (manual atau default).')
        return
      }

      var target = (targetEl && targetEl.value) || 'all'
      var skipPremium = skipPremiumEl ? skipPremiumEl.checked : true

      sendAds.disabled = true
      sendAds.classList.add('is-loading')
      if (msg) { msg.textContent = 'Mengirim...'; msg.className = 'msg' }
      if (resultEl) resultEl.innerHTML = ''
      if (progressWrap) progressWrap.classList.add('show')
      if (progressBar) progressBar.style.width = '0%'
      if (progressText) progressText.textContent = 'Menyiapkan...'

      var allResults = []
      var totalSent = 0

      try {
        var targets = []
        if (target === 'all') {
          var overview = await Z.api('/admin/overview', { timeoutMs: 20000 })
          targets = (overview.bots || [])
            .filter(function (b) { return b.status === 'connected' })
            .map(function (b) { return { sessionId: b.sessionId, botName: b.botName } })
        } else {
          targets = [{ sessionId: target, botName: target }]
        }

        if (!targets.length) {
          if (msg) { msg.textContent = 'Tidak ada bot connected.'; msg.className = 'msg err' }
          alert('Tidak ada bot yang terhubung.')
          return
        }

        var n = targets.length
        for (var i = 0; i < n; i++) {
          var t = targets[i]
          if (progressText) {
            progressText.textContent = 'Bot ' + (i + 1) + ' / ' + n + ' — ' + (t.botName || t.sessionId) + ' ...'
          }
          if (progressBar) progressBar.style.width = Math.round((i / n) * 100) + '%'

          try {
            var data = await Z.api('/admin/ads/send', {
              method: 'POST',
              body: { target: t.sessionId, text: text, skipPremium: skipPremium },
              timeoutMs: 120000
            })
            var rows = data.results || []
            rows.forEach(function (r) {
              allResults.push(r)
              totalSent += (r.sent || 0)
            })
            if (resultEl) {
              resultEl.innerHTML = allResults.map(function (r) {
                var status = r.error ? ('<span class="badge">Gagal: ' + esc(r.error) + '</span>')
                  : r.skipped ? '<span class="badge">Dilewati (premium)</span>'
                  : '<span class="badge premium">' + r.sent + ' grup</span>'
                return '<div class="bot-card"><div><h3>' + esc(r.botName || r.sessionId) + '</h3>' +
                  '<div class="bot-meta">' + esc(r.sessionId) + '</div></div>' + status + '</div>'
              }).join('')
            }
          } catch (e) {
            allResults.push({ sessionId: t.sessionId, botName: t.botName, sent: 0, error: e.message })
            if (resultEl) {
              resultEl.innerHTML = allResults.map(function (r) {
                var status = r.error ? ('<span class="badge">Gagal: ' + esc(r.error) + '</span>')
                  : r.skipped ? '<span class="badge">Dilewati (premium)</span>'
                  : '<span class="badge premium">' + r.sent + ' grup</span>'
                return '<div class="bot-card"><div><h3>' + esc(r.botName || r.sessionId) + '</h3>' +
                  '<div class="bot-meta">' + esc(r.sessionId) + '</div></div>' + status + '</div>'
              }).join('')
            }
          }

          if (progressBar) progressBar.style.width = Math.round(((i + 1) / n) * 100) + '%'
          if (progressText) {
            progressText.textContent = 'Bot ' + (i + 1) + ' / ' + n + ' selesai · total ' + totalSent + ' grup'
          }
        }

        if (msg) {
          msg.textContent = 'Selesai. Terkirim ke total ' + totalSent + ' grup dari ' + n + ' bot.'
          msg.className = 'msg ok'
        }
        if (totalSent === 0) {
          alert('Gak ada yang kekirim. Kemungkinan bot belum connected, atau semuanya dilewati (premium). Cek hasil di bawah.')
        }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
        alert('Gagal kirim: ' + e.message)
      } finally {
        sendAds.disabled = false
        sendAds.classList.remove('is-loading')
        if (progressBar) progressBar.style.width = '100%'
      }
    }
  }

  Z.bootPage(async function () {
    try {
      var me = await Z.api('/auth/me', { timeoutMs: 8000 })
      Z.state.user = me.user
      if (!me.user || !me.user.isAdmin) {
        alert('Akses admin saja')
        location.replace('/dashboard')
        return
      }
    } catch (e) {
      if (e.status === 401) return
      alert('Gagal cek admin')
      location.replace('/dashboard')
      return
    }

    var page = pageName()

    try {
      var data = await Z.api('/admin/overview', { timeoutMs: 20000 })
      renderStats(data.stats)

      if (page === 'admin' || page === 'admin-users') {
        renderUsers(data.accounts)
      }
      if (page === 'admin' || page === 'admin-bots') {
        renderBots(data.bots)
      }
      if (page === 'admin') {
        renderOrders(data.orders)
      }
      if (page === 'admin-ads') {
        fillAdsTarget(data.bots)
        bindAdsSettings()
      }
    } catch (e) {
      alert(e.message || 'Gagal memuat admin')
      if (e.status === 403) location.replace('/dashboard')
    }
  })
})()
