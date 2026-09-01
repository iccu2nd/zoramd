(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  async function loadPremium() {
    var botId = Z.$('#upgrade-bot-select') && Z.$('#upgrade-bot-select').value
    if (!botId) return
    try {
      var data = await Z.api('/bots/' + botId + '/premium')
      var sub = data.subscription || {}
      var box = Z.$('#sub-status')
      if (box) {
        box.textContent = data.isPremium
          ? 'Premium aktif sampai ' + (sub.expiresAt ? new Date(sub.expiresAt).toLocaleString('id-ID') : '-')
          : 'Paket saat ini: Free'
      }
    } catch (e) {
      var box = Z.$('#sub-status')
      if (box) box.textContent = e.message
    }
  }

  Z.bootPage(function () {
    Z.fillBotSelect('upgrade-bot-select')
    loadPremium()
    var sel = Z.$('#upgrade-bot-select')
    if (sel) sel.onchange = loadPremium

    var orderBtn = Z.$('#order-premium-btn')
    if (orderBtn) orderBtn.onclick = async function () {
      var botId = Z.$('#upgrade-bot-select') && Z.$('#upgrade-bot-select').value
      if (!botId) return
      var msg = Z.$('#upgrade-msg')
      if (msg) msg.textContent = ''
      try {
        var data = await Z.api('/bots/' + botId + '/premium/order', {
          method: 'POST',
          body: { method: (Z.$('#pay-method') && Z.$('#pay-method').value) || 'qris' },
          timeoutMs: 25000
        })
        var info = Z.$('#payment-info')
        if (info) {
          Z.show(info)
          var p = data.payment || {}
          info.innerHTML = '<strong>Order ID:</strong> ' + Z.escapeHtml(data.orderId) +
            '<br/><strong>Jumlah:</strong> Rp' + Number(data.amount).toLocaleString('id-ID') +
            '<pre style="margin-top:8px;font-size:12px;white-space:pre-wrap">' +
            Z.escapeHtml(JSON.stringify(p, null, 2).slice(0, 800)) + '</pre>'
        }
        if (Z.$('#check-order-id')) Z.$('#check-order-id').value = data.orderId
        if (msg) { msg.textContent = 'Order dibuat. Bayar lalu tekan Cek Status.'; msg.className = 'msg ok' }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
      }
    }

    var checkBtn = Z.$('#check-payment-btn')
    if (checkBtn) checkBtn.onclick = async function () {
      var botId = Z.$('#upgrade-bot-select') && Z.$('#upgrade-bot-select').value
      var orderId = Z.$('#check-order-id') && Z.$('#check-order-id').value.trim()
      if (!botId || !orderId) return alert('Isi Order ID')
      var msg = Z.$('#upgrade-msg')
      try {
        var data = await Z.api('/bots/' + botId + '/premium/check', {
          method: 'POST', body: { orderId: orderId }, timeoutMs: 20000
        })
        if (data.status === 'paid') {
          if (msg) { msg.textContent = 'Pembayaran valid. Premium aktif!'; msg.className = 'msg ok' }
          await loadPremium()
        } else {
          if (msg) { msg.textContent = 'Masih pending. Bayar dulu lalu cek lagi.'; msg.className = 'msg' }
        }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
      }
    }
  })
})()
