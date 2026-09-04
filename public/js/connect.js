(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  var pollTimer = null
  var pollCount = 0
  var lastConnectionStatus = null
  var MAX_POLLS = 24 // ~2 menit @ 5s

  function renderBotsList() {
    var wrap = document.getElementById('connected-bots-list')
    if (!wrap) return
    var bots = Z.state.bots || []
    if (!bots.length) {
      wrap.innerHTML = '<p class="hint">Belum ada bot. Buat di Dashboard dulu.</p>'
      return
    }
    wrap.innerHTML = bots.map(function (b) {
      var pic = b.profilePic
        ? '<img class="wa-avatar" src="' + Z.escapeHtml(b.profilePic) + '" alt="" />'
        : '<div class="wa-avatar wa-avatar-fallback">' + Z.escapeHtml((b.waName || b.botName || '?').charAt(0).toUpperCase()) + '</div>'
      var name = b.waName || b.botName || 'Bot'
      var num = b.waNumber ? '+' + b.waNumber : (b.sessionId || '')
      var st = b.status || 'disconnected'
      var off = b.enabled === false
      return '<div class="wa-bot-card' + (off ? ' is-off' : '') + '" data-id="' + Z.escapeHtml(b.id) + '">' +
        pic +
        '<div class="wa-bot-info">' +
          '<div class="wa-bot-name">' + Z.escapeHtml(name) + '</div>' +
          '<div class="wa-bot-meta">' + Z.escapeHtml(num) + '</div>' +
        '</div>' +
        '<span class="badge ' + Z.escapeHtml(st) + '">' + (off ? 'off' : Z.escapeHtml(st)) + '</span>' +
      '</div>'
    }).join('')
    wrap.querySelectorAll('.wa-bot-card').forEach(function (card) {
      card.onclick = function () {
        var sel = document.getElementById('connect-bot-select')
        if (sel) {
          sel.value = card.getAttribute('data-id')
          sel.dispatchEvent(new Event('change'))
        }
      }
    })
  }


  function updateConnectUI(st) {
    if (!st) return
    if (st.status === 'connected' && lastConnectionStatus !== 'connected') {
      Z.toast('Bot connected successfully.', 'success')
    } else if (st.status === 'disconnected' && lastConnectionStatus === 'connected') {
      Z.toast('Bot terputus dari WhatsApp.', 'warning')
    }
    lastConnectionStatus = st.status
    var box = Z.$('#connect-status')
    if (box) {
      var text = 'Status: ' + st.status
      if (st.lastError) text += ' (' + st.lastError + ')'
      box.textContent = text
    }
    var qrWrap = Z.$('#qr-wrap')
    var qrImg = Z.$('#qr-img')
    if (st.qr && qrWrap && qrImg) {
      if (qrImg.src !== st.qr) qrImg.src = st.qr
      Z.show(qrWrap)
    } else if (qrWrap) Z.hide(qrWrap)

    var pWrap = Z.$('#pairing-code-wrap')
    var pCode = Z.$('#pairing-code')
    if (st.pairingCode && pWrap && pCode) {
      pCode.textContent = st.pairingCode
      Z.show(pWrap)
    } else if (pWrap && !st.pairingCode) {
      // jangan hide jika status masih pairing (kode bisa sebentar null)
      if (st.status !== 'pairing') Z.hide(pWrap)
    }
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    pollCount = 0
  }

  function shouldPoll(status) {
    return status === 'connecting' || status === 'qr' || status === 'pairing'
  }

  function startPoll(botId) {
    stopPoll()
    pollCount = 0
    pollTimer = setInterval(async function () {
      pollCount++
      if (pollCount > MAX_POLLS) {
        stopPoll()
        return
      }
      try {
        var data = await Z.api('/bots/' + botId + '/status', { timeoutMs: 8000 })
        updateConnectUI(data.state)
        if (!data.state || !shouldPoll(data.state.status)) {
          // connected / disconnected → stop polling
          stopPoll()
        }
      } catch (e) {
        if (e.status === 401) { stopPoll(); Z.goToLogin('session') }
      }
    }, 5000) // 5 detik — cukup untuk QR/pairing tanpa spam
  }

  Z.bootPage(function () {
    Z.fillBotSelect('connect-bot-select')
    renderBotsList()
    if (Z.state.user && Z.state.user.isAdmin) {
      var n = document.getElementById('nav-admin')
      if (n) n.classList.remove('hidden')
    }

    document.querySelectorAll('input[name="connect-method"]').forEach(function (r) {
      r.onchange = function () {
        var wrap = Z.$('#pairing-phone-wrap')
        if (!wrap) return
        if (r.value === 'pairing' && r.checked) Z.show(wrap)
        else Z.hide(wrap)
      }
    })

    var startBtn = Z.$('#connect-start-btn')
    if (startBtn) startBtn.onclick = async function () {
      var botId = Z.$('#connect-bot-select') && Z.$('#connect-bot-select').value
      if (!botId) return Z.toast('Select a bot first.', 'warning')
      var method = (document.querySelector('input[name="connect-method"]:checked') || {}).value || 'qr'
      var phone = Z.$('#pairing-phone') && Z.$('#pairing-phone').value
      if (method === 'pairing' && !phone) return Z.toast('Enter a WhatsApp number (e.g. 628...) first.', 'warning')

      var box = Z.$('#connect-status')
      if (box) box.innerHTML = '<div class="inline-loading"><div class="spinner tiny" aria-hidden="true"><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div></div> Menghubungkan... (pairing bisa 5–10 detik)</div>'
      Z.hide(Z.$('#qr-wrap'))
      Z.hide(Z.$('#pairing-code-wrap'))
      startBtn.disabled = true
      stopPoll()
      lastConnectionStatus = null
      try {
        var data = await Z.api('/bots/' + botId + '/connect', {
          method: 'POST',
          body: { method: method, phoneNumber: phone },
          timeoutMs: 45000
        })
        updateConnectUI(data.state)
        if (shouldPoll(data.state && data.state.status)) startPoll(botId)
        Z.loadBots().then(renderBotsList).catch(function(){})
        // Satu fetch tambahan setelah 4s (kode pairing/QR sering muncul belakangan)
        setTimeout(async function () {
          try {
            var s = await Z.api('/bots/' + botId + '/status', { timeoutMs: 8000 })
            updateConnectUI(s.state)
            if (shouldPoll(s.state && s.state.status) && !pollTimer) startPoll(botId)
          } catch (e) {}
        }, 4000)
      } catch (e) {
        if (e.status === 401) return Z.goToLogin('session')
        if (box) box.textContent = e.message
        Z.toast(e.message, 'error')
      } finally {
        startBtn.disabled = false
      }
    }

    var stopBtn = Z.$('#connect-stop-btn')
    if (stopBtn) stopBtn.onclick = async function () {
      var botId = Z.$('#connect-bot-select') && Z.$('#connect-bot-select').value
      if (!botId) return
      stopPoll()
      try {
        await Z.api('/bots/' + botId + '/disconnect', { method: 'POST', body: {} })
        var box = Z.$('#connect-status')
        if (box) box.textContent = 'Terputus'
        Z.hide(Z.$('#qr-wrap'))
        Z.hide(Z.$('#pairing-code-wrap'))
        Z.toast('Koneksi bot berhasil diputuskan.', 'success')
      } catch (e) { Z.toast(e.message, 'error') }
    }

    var logoutBtn = Z.$('#connect-logout-btn')
    if (logoutBtn) logoutBtn.onclick = async function () {
      var botId = Z.$('#connect-bot-select') && Z.$('#connect-bot-select').value
      if (!botId) return
      if (!confirm('Logout session? Bot harus pairing/QR ulang.')) return
      stopPoll()
      try {
        await Z.api('/bots/' + botId + '/disconnect', { method: 'POST', body: { clearSession: true } })
        var box = Z.$('#connect-status')
        if (box) box.textContent = 'Session dihapus'
        Z.hide(Z.$('#qr-wrap'))
        Z.hide(Z.$('#pairing-code-wrap'))
        Z.toast('Session bot berhasil dihapus. Bot perlu pairing atau QR ulang.', 'success')
      } catch (e) { Z.toast(e.message, 'error') }
    }

    // Bersihkan poll saat keluar halaman
    var rs = document.getElementById('restart-bot-btn')
    if (rs) rs.onclick = async function () {
      var botId = Z.$('#connect-bot-select') && Z.$('#connect-bot-select').value
      if (!botId) return Z.toast('Select a bot first.', 'warning')
      if (!confirm('Restart bot?')) return
      try {
        await Z.restartBot(botId)
        var box = Z.$('#connect-status')
        if (box) box.textContent = 'Bot di-restart'
        Z.toast('Bot berhasil di-restart.', 'success')
      } catch (e) { Z.toast(e.message, 'error') }
    }
    window.addEventListener('beforeunload', stopPoll)
  })
})()
