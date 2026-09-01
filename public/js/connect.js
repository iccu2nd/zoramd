(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  var pollTimer = null
  var pollCount = 0
  var MAX_POLLS = 24 // ~2 menit @ 5s

  function updateConnectUI(st) {
    if (!st) return
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
      if (!botId) return alert('Pilih bot dulu')
      var method = (document.querySelector('input[name="connect-method"]:checked') || {}).value || 'qr'
      var phone = Z.$('#pairing-phone') && Z.$('#pairing-phone').value
      if (method === 'pairing' && !phone) return alert('Isi nomor WhatsApp (628...)')

      var box = Z.$('#connect-status')
      if (box) box.innerHTML = '<div class="inline-loading"><span class="dot-spinner"></span> Menghubungkan... (pairing bisa 5–10 detik)</div>'
      Z.hide(Z.$('#qr-wrap'))
      Z.hide(Z.$('#pairing-code-wrap'))
      startBtn.disabled = true
      stopPoll()
      try {
        var data = await Z.api('/bots/' + botId + '/connect', {
          method: 'POST',
          body: { method: method, phoneNumber: phone },
          timeoutMs: 45000
        })
        updateConnectUI(data.state)
        if (shouldPoll(data.state && data.state.status)) startPoll(botId)
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
      } catch (e) { alert(e.message) }
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
      } catch (e) { alert(e.message) }
    }

    // Bersihkan poll saat keluar halaman
    window.addEventListener('beforeunload', stopPoll)
  })
})()
