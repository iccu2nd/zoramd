(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  var pollTimer = null

  function updateConnectUI(st) {
    if (!st) return
    var box = Z.$('#connect-status')
    if (box) box.textContent = 'Status: ' + st.status + (st.lastError ? ' (' + st.lastError + ')' : '')
    var qrWrap = Z.$('#qr-wrap')
    var qrImg = Z.$('#qr-img')
    if (st.qr && qrWrap && qrImg) {
      qrImg.src = st.qr
      Z.show(qrWrap)
    } else if (qrWrap) Z.hide(qrWrap)
    var pWrap = Z.$('#pairing-code-wrap')
    var pCode = Z.$('#pairing-code')
    if (st.pairingCode && pWrap && pCode) {
      pCode.textContent = st.pairingCode
      Z.show(pWrap)
    } else if (pWrap) Z.hide(pWrap)
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }
  function startPoll(botId) {
    stopPoll()
    pollTimer = setInterval(async function () {
      try {
        var data = await Z.api('/bots/' + botId + '/status', { timeoutMs: 8000 })
        updateConnectUI(data.state)
        if (data.state && (data.state.status === 'connected' || data.state.status === 'disconnected')) {
          if (data.state.status === 'connected') stopPoll()
        }
      } catch (e) {}
    }, 2500)
  }

  Z.bootPage(function () {
    Z.fillBotSelect('connect-bot-select')

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
      var box = Z.$('#connect-status')
      if (box) box.innerHTML = '<div class="inline-loading"><span class="dot-spinner"></span> Menghubungkan...</div>'
      Z.hide(Z.$('#qr-wrap'))
      Z.hide(Z.$('#pairing-code-wrap'))
      startBtn.disabled = true
      try {
        var data = await Z.api('/bots/' + botId + '/connect', {
          method: 'POST',
          body: { method: method, phoneNumber: phone },
          timeoutMs: 20000
        })
        updateConnectUI(data.state)
        startPoll(botId)
        setTimeout(async function () {
          try {
            var s = await Z.api('/bots/' + botId + '/status')
            updateConnectUI(s.state)
          } catch (e) {}
        }, 3000)
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
      if (!confirm('Logout session? Bot harus pairing ulang.')) return
      stopPoll()
      try {
        await Z.api('/bots/' + botId + '/disconnect', { method: 'POST', body: { clearSession: true } })
        var box = Z.$('#connect-status')
        if (box) box.textContent = 'Session dihapus'
        Z.hide(Z.$('#qr-wrap'))
        Z.hide(Z.$('#pairing-code-wrap'))
      } catch (e) { alert(e.message) }
    }
  })
})()
