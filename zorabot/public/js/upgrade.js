(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  var currentOrder = null
  var expiryTimer = null

  function fmtTime(ms) {
    if (ms <= 0) return '00:00'
    var m = Math.floor(ms / 60000)
    var s = Math.floor((ms % 60000) / 1000)
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
  }

  function startExpiryCountdown(expiresAt) {
    if (expiryTimer) clearInterval(expiryTimer)
    var el = document.getElementById('order-expiry')
    if (!el || !expiresAt) return
    function tick() {
      var left = new Date(expiresAt).getTime() - Date.now()
      if (left <= 0) {
        el.textContent = 'Order kedaluwarsa. Buat order baru.'
        clearInterval(expiryTimer)
        return
      }
      el.textContent = 'Berlaku sisa ' + fmtTime(left) + ' (max 30 menit)'
    }
    tick()
    expiryTimer = setInterval(tick, 1000)
  }

  function renderPayment(data) {
    var info = document.getElementById('payment-info')
    if (!info) return
    Z.show(info)
    var p = data.payment || {}
    var html = '<div><strong>Order ID:</strong> <code id="shown-order-id">' + Z.escapeHtml(data.orderId) + '</code></div>'
    html += '<div style="margin-top:6px"><strong>Total:</strong> Rp' + Number(data.amount || 0).toLocaleString('id-ID') + '</div>'

    if (p.qr_string || p.qr_image) {
      var qrSrc = p.qr_image || ('https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(p.qr_string))
      html += '<div class="qris-box"><img id="qris-img" src="' + Z.escapeHtml(qrSrc) + '" alt="QRIS"/><p class="hint" style="margin:8px 0 0">Scan QRIS untuk bayar</p></div>'
      html += '<div class="payment-actions">' +
        '<a class="btn outline" id="dl-qris" href="' + Z.escapeHtml(qrSrc) + '" download="qris-zorabot.png" target="_blank" rel="noopener">⬇ Download QRIS</span></a>' +
        '<button type="button" class="btn primary" id="btn-check-pay"><i class="fa-solid fa-circle-check"></i><span>Cek Status Pembayaran</span></button>' +
        '<button type="button" class="btn danger" id="btn-cancel-pay"><i class="fa-solid fa-xmark"></i><span>Batalkan Transaksi</span></button>' +
        '</div>'
    } else {
      html += '<div class="payment-actions">' +
        '<button type="button" class="btn primary" id="btn-check-pay"><i class="fa-solid fa-circle-check"></i><span>Cek Status Pembayaran</span></button>' +
        '<button type="button" class="btn danger" id="btn-cancel-pay"><i class="fa-solid fa-xmark"></i><span>Batalkan Transaksi</span></button>' +
        '</div>'
      if (p.account_number) {
        html += '<p style="margin-top:10px">No. rekening: <strong>' + Z.escapeHtml(p.account_number) + '</strong>' +
          (p.bank ? ' (' + Z.escapeHtml(p.bank) + ')' : '') + '</p>'
      }
      if (p.redirect_url || p.payment_link) {
        var link = p.redirect_url || p.payment_link
        html += '<p style="margin-top:8px"><a href="' + Z.escapeHtml(link) + '" target="_blank" rel="noopener">Buka halaman pembayaran</a></p>'
      }
    }
    html += '<p class="expiry-note" id="order-expiry"></p>'
    info.innerHTML = html

    var checkOid = document.getElementById('check-order-id')
    if (checkOid) checkOid.value = data.orderId

    startExpiryCountdown(data.expiresAt)

    var chk = document.getElementById('btn-check-pay')
    if (chk) chk.onclick = function () { doCheck(data.orderId) }
    var can = document.getElementById('btn-cancel-pay')
    if (can) can.onclick = function () { doCancel(data.orderId) }
  }

  async function loadPremium() {
    var botId = Z.$('#upgrade-bot-select') && Z.$('#upgrade-bot-select').value
    if (!botId) return
    try {
      var data = await Z.api('/bots/' + botId + '/premium')
      var sub = data.subscription || {}
      var box = Z.$('#sub-status')
      if (box) {
        box.innerHTML = data.isPremium
          ? '<span class="badge premium">Premium</span> aktif sampai ' + (sub.expiresAt ? new Date(sub.expiresAt).toLocaleString('id-ID') : '-')
          : '<span class="badge free">Free</span> — upgrade untuk fitur lengkap'
      }
    } catch (e) {
      var box = Z.$('#sub-status')
      if (box) box.textContent = e.message
    }
  }

  async function doCheck(orderId) {
    var botId = Z.$('#upgrade-bot-select') && Z.$('#upgrade-bot-select').value
    var oid = orderId || (Z.$('#check-order-id') && Z.$('#check-order-id').value.trim())
    if (!botId || !oid) return alert('Pilih bot dan isi Order ID')
    var msg = Z.$('#upgrade-msg')
    var btn = document.getElementById('btn-check-pay') || document.getElementById('check-payment-btn')
    if (btn) btn.classList.add('is-loading')
    try {
      var data = await Z.api('/bots/' + botId + '/premium/check', {
        method: 'POST', body: { orderId: oid }, timeoutMs: 25000
      })
      if (data.status === 'paid') {
        if (msg) { msg.textContent = 'Pembayaran valid. Premium aktif!'; msg.className = 'msg ok' }
        await loadPremium()
      } else if (data.status === 'expired') {
        if (msg) { msg.textContent = data.message || 'Order kedaluwarsa'; msg.className = 'msg err' }
      } else if (data.status === 'cancelled') {
        if (msg) { msg.textContent = 'Order dibatalkan'; msg.className = 'msg' }
      } else {
        if (msg) { msg.textContent = 'Masih pending. Bayar dulu lalu cek lagi.'; msg.className = 'msg' }
      }
    } catch (e) {
      if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
    } finally {
      if (btn) btn.classList.remove('is-loading')
    }
  }

  async function doCancel(orderId) {
    var botId = Z.$('#upgrade-bot-select') && Z.$('#upgrade-bot-select').value
    if (!botId || !orderId) return
    if (!confirm('Batalkan transaksi ini?')) return
    var msg = Z.$('#upgrade-msg')
    try {
      await Z.api('/bots/' + botId + '/premium/cancel', {
        method: 'POST', body: { orderId: orderId }
      })
      if (msg) { msg.textContent = 'Transaksi dibatalkan.'; msg.className = 'msg' }
      if (expiryTimer) clearInterval(expiryTimer)
    } catch (e) {
      if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
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
      orderBtn.classList.add('is-loading')
      orderBtn.disabled = true
      try {
        var data = await Z.api('/bots/' + botId + '/premium/order', {
          method: 'POST',
          body: { method: (Z.$('#pay-method') && Z.$('#pay-method').value) || 'qris' },
          timeoutMs: 45000
        })
        currentOrder = data
        renderPayment(data)
        if (msg) { msg.textContent = 'Order dibuat. Bayar dalam 30 menit.'; msg.className = 'msg ok' }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
      } finally {
        orderBtn.classList.remove('is-loading')
        orderBtn.disabled = false
      }
    }

    var checkBtn = Z.$('#check-payment-btn')
    if (checkBtn) checkBtn.onclick = function () { doCheck() }
  })
})()
