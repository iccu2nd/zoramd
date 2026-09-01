const { $, show, escapeHtml, api, bootPage, fillBotSelect } = window.Zora

async function loadPremium() {
  const botId = $('#upgrade-bot-select')?.value
  if (!botId) return
  try {
    const data = await api(`/bots/${botId}/premium`)
    const sub = data.subscription || {}
    $('#sub-status').textContent = data.isPremium
      ? `Premium aktif sampai ${sub.expiresAt ? new Date(sub.expiresAt).toLocaleString('id-ID') : '-'}`
      : 'Paket saat ini: Free'
  } catch (e) {
    $('#sub-status').textContent = e.message
  }
}

bootPage(() => {
  fillBotSelect('upgrade-bot-select')
  loadPremium()
  $('#upgrade-bot-select').onchange = loadPremium

  $('#order-premium-btn').onclick = async () => {
    const botId = $('#upgrade-bot-select')?.value
    if (!botId) return
    $('#upgrade-msg').textContent = ''
    try {
      const data = await api(`/bots/${botId}/premium/order`, {
        method: 'POST',
        body: JSON.stringify({ method: $('#pay-method').value })
      })
      show($('#payment-info'))
      const p = data.payment || {}
      $('#payment-info').innerHTML = `
        <strong>Order ID:</strong> ${escapeHtml(data.orderId)}<br/>
        <strong>Jumlah:</strong> Rp${Number(data.amount).toLocaleString('id-ID')}<br/>
        <pre style="margin-top:8px;font-size:12px;white-space:pre-wrap">${escapeHtml(JSON.stringify(p, null, 2).slice(0, 800))}</pre>
      `
      $('#check-order-id').value = data.orderId
      $('#upgrade-msg').textContent = 'Order dibuat. Selesaikan pembayaran lalu tekan Cek Status.'
      $('#upgrade-msg').className = 'msg ok'
    } catch (e) {
      $('#upgrade-msg').textContent = e.message
      $('#upgrade-msg').className = 'msg err'
    }
  }

  $('#check-payment-btn').onclick = async () => {
    const botId = $('#upgrade-bot-select')?.value
    const orderId = $('#check-order-id')?.value.trim()
    if (!botId || !orderId) return alert('Isi Order ID')
    try {
      const data = await api(`/bots/${botId}/premium/check`, {
        method: 'POST',
        body: JSON.stringify({ orderId })
      })
      if (data.status === 'paid') {
        $('#upgrade-msg').textContent = 'Pembayaran valid. Premium diaktifkan!'
        $('#upgrade-msg').className = 'msg ok'
        await loadPremium()
      } else {
        $('#upgrade-msg').textContent = 'Masih pending. Selesaikan pembayaran lalu cek lagi.'
        $('#upgrade-msg').className = 'msg'
      }
    } catch (e) {
      $('#upgrade-msg').textContent = e.message
      $('#upgrade-msg').className = 'msg err'
    }
  }
})
