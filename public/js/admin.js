(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  function esc(s) { return Z.escapeHtml(s) }

  Z.bootPage(async function () {
    // Platform ads settings
    try {
      var plat = await Z.api('/admin/platform')
      var s = plat.settings || {}
      var adsEl = document.getElementById('admin-free-ads')
      if (adsEl) adsEl.checked = s.freeAdsEnabled !== false
      var adsTx = document.getElementById('admin-ads-text')
      if (adsTx) adsTx.value = s.adsText || ''
    } catch (e) {}
    var saveAds = document.getElementById('admin-ads-save')
    if (saveAds) saveAds.onclick = async function () {
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

    var sendAds = document.getElementById('admin-ads-send')
    if (sendAds) sendAds.onclick = async function () {
      var msg = document.getElementById('admin-ads-send-msg')
      var resultEl = document.getElementById('admin-ads-send-result')
      var manualText = document.getElementById('admin-ads-manual-text').value.trim()
      var defaultText = document.getElementById('admin-ads-text').value.trim()
      var text = manualText || defaultText
      if (!text) {
        if (msg) { msg.textContent = 'Isi teks iklan dulu (manual atau default).'; msg.className = 'msg err' }
        return
      }
      var target = document.getElementById('admin-ads-target').value || 'all'
      var skipPremium = document.getElementById('admin-ads-skip-premium').checked

      sendAds.disabled = true
      sendAds.classList.add('is-loading')
      if (msg) { msg.textContent = 'Mengirim...'; msg.className = 'msg' }
      if (resultEl) resultEl.innerHTML = ''

      try {
        var data = await Z.api('/admin/ads/send', {
          method: 'POST',
          body: { target: target, text: text, skipPremium: skipPremium },
          timeoutMs: 60000
        })
        if (msg) { msg.textContent = 'Terkirim ke total ' + (data.totalSent || 0) + ' grup.'; msg.className = 'msg ok' }
        if (resultEl) {
          resultEl.innerHTML = (data.results || []).map(function (r) {
            var status = r.error ? ('<span class="badge">Gagal: ' + esc(r.error) + '</span>')
              : r.skipped ? '<span class="badge">Dilewati (premium)</span>'
              : '<span class="badge premium">' + r.sent + ' grup</span>'
            return '<div class="bot-card"><div><h3>' + esc(r.botName || r.sessionId) + '</h3>' +
              '<div class="bot-meta">' + esc(r.sessionId) + '</div></div>' + status + '</div>'
          }).join('')
        }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
      } finally {
        sendAds.disabled = false
        sendAds.classList.remove('is-loading')
      }
    }

    if (!Z.state.user || !Z.state.user.isAdmin) {
      alert('Akses admin saja')
      location.replace('/dashboard')
      return
    }
    var n = document.getElementById('nav-admin')
    if (n) n.classList.remove('hidden')

    try {
      var data = await Z.api('/admin/overview', { timeoutMs: 20000 })
      var st = data.stats || {}
      var stats = document.getElementById('admin-stats')
      if (stats) {
        stats.innerHTML = '<span>Users: <strong>' + st.users + '</strong></span>' +
          '<span>Bots: <strong>' + st.bots + '</strong></span>' +
          '<span>Connected: <strong>' + st.connected + '</strong></span>' +
          '<span>Orders: <strong>' + st.orders + '</strong></span>'
      }

      var usersEl = document.getElementById('admin-users')
      if (usersEl) {
        usersEl.innerHTML = (data.accounts || []).map(function (a) {
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

      var botsEl = document.getElementById('admin-bots')
      if (botsEl) {
        botsEl.innerHTML = (data.bots || []).map(function (b) {
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

      // Isi pilihan target bot untuk kirim iklan manual (hanya yang connected)
      var targetSel = document.getElementById('admin-ads-target')
      if (targetSel) {
        var connectedBots = (data.bots || []).filter(function (b) { return b.status === 'connected' })
        targetSel.innerHTML = '<option value="all">Semua Bot (connected)</option>' +
          connectedBots.map(function (b) {
            return '<option value="' + esc(b.sessionId) + '">' + esc(b.botName || b.sessionId) + '</option>'
          }).join('')
      }

      var ordersEl = document.getElementById('admin-orders')
      if (ordersEl) {
        ordersEl.innerHTML = (data.orders || []).map(function (o) {
          return '<div class="bot-card"><div><h3>' + esc(o.orderId) + '</h3>' +
            '<div class="bot-meta">Rp' + Number(o.amount || 0).toLocaleString('id-ID') +
            ' · bot ' + esc(o.botId) + '</div></div>' +
            '<span class="badge">' + esc(o.status) + '</span></div>'
        }).join('') || '<p class="hint">Tidak ada order</p>'
      }
    } catch (e) {
      alert(e.message || 'Gagal memuat admin')
      if (e.status === 403) location.replace('/dashboard')
    }
  })
})()
