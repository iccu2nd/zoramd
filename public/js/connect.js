const { $, show, hide, state, api, bootPage, fillBotSelect, goToLogin } = window.Zora

function updateConnectUI(st) {
  if (!st) return
  $('#connect-status').textContent = `Status: ${st.status}` + (st.lastError ? ` (${st.lastError})` : '')
  if (st.qr) {
    show($('#qr-wrap'))
    $('#qr-img').src = st.qr
  } else hide($('#qr-wrap'))
  if (st.pairingCode) {
    show($('#pairing-code-wrap'))
    $('#pairing-code').textContent = st.pairingCode
  } else hide($('#pairing-code-wrap'))
}

function startStatusPoll(botId) {
  stopStatusPoll()
  state.pollTimer = setInterval(async () => {
    try {
      const data = await api(`/bots/${botId}/status`)
      updateConnectUI(data.state)
      if (data.state?.status === 'connected' || data.state?.status === 'disconnected') {
        if (data.state.status === 'connected') stopStatusPoll()
      }
    } catch {}
  }, 2500)
}
function stopStatusPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer)
  state.pollTimer = null
}

bootPage(() => {
  fillBotSelect('connect-bot-select')

  document.querySelectorAll('input[name="connect-method"]').forEach(r => {
    r.onchange = () => {
      if (r.value === 'pairing' && r.checked) show($('#pairing-phone-wrap'))
      else hide($('#pairing-phone-wrap'))
    }
  })

  $('#connect-start-btn').onclick = async () => {
    const botId = $('#connect-bot-select')?.value
    if (!botId) return alert('Pilih bot dulu')
    const method = document.querySelector('input[name="connect-method"]:checked')?.value || 'qr'
    const phoneNumber = $('#pairing-phone')?.value
    $('#connect-status').innerHTML = '<div class="inline-loading"><span class="dot-spinner"></span> Menghubungkan bot...</div>'
    hide($('#qr-wrap'))
    hide($('#pairing-code-wrap'))
    $('#connect-start-btn').disabled = true
    try {
      const data = await api(`/bots/${botId}/connect`, {
        method: 'POST',
        body: JSON.stringify({ method, phoneNumber })
      })
      updateConnectUI(data.state)
      // Poll lebih sering di awal supaya QR / pairing code muncul
      startStatusPoll(botId)
      // Satu fetch ekstra setelah 3s (pairing code butuh delay di server)
      setTimeout(async () => {
        try {
          const s = await api(`/bots/${botId}/status`)
          updateConnectUI(s.state)
        } catch {}
      }, 3000)
    } catch (e) {
      if (e.status === 401) return goToLogin('session')
      $('#connect-status').textContent = e.message
    } finally {
      $('#connect-start-btn').disabled = false
    }
  }

  $('#connect-stop-btn').onclick = async () => {
    const botId = $('#connect-bot-select')?.value
    if (!botId) return
    stopStatusPoll()
    try {
      await api(`/bots/${botId}/disconnect`, { method: 'POST', body: JSON.stringify({}) })
      $('#connect-status').textContent = 'Terputus'
      hide($('#qr-wrap'))
      hide($('#pairing-code-wrap'))
    } catch (e) { alert(e.message) }
  }

  $('#connect-logout-btn').onclick = async () => {
    const botId = $('#connect-bot-select')?.value
    if (!botId) return
    if (!confirm('Logout session? Bot harus pairing ulang.')) return
    stopStatusPoll()
    try {
      await api(`/bots/${botId}/disconnect`, {
        method: 'POST',
        body: JSON.stringify({ clearSession: true })
      })
      $('#connect-status').textContent = 'Session dihapus'
      hide($('#qr-wrap'))
      hide($('#pairing-code-wrap'))
    } catch (e) { alert(e.message) }
  }
})
