(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  var currentOrder = null
  var expiryTimer = null
  var STORAGE_KEY = 'zorabot_pending_order'

  function savePending(data) {
    try {
      if (!data) { localStorage.removeItem(STORAGE_KEY); return }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        orderId: data.orderId,
        amount: data.amount,
        expiresAt: data.expiresAt,
        payment: data.payment,
        savedAt: Date.now()
      }))
    } catch (e) {}
  }

  function loadPending() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      var data = JSON.parse(raw)
      if (!data || !data.orderId) return null
      if (data.expiresAt && new Date(data.expiresAt).getTime() < Date.now()) {
        localStorage.removeItem(STORAGE_KEY)
        return null
      }
      return data
    } catch (e) { return null }
  }

  function setOrderBtnVisible(show) {
    var btn = document.getElementById('order-premium-btn')
    if (!btn) return
    if (show) {
      btn.classList.remove('hidden')
      btn.style.display = ''
    } else {
      btn.classList.add('hidden')
      btn.style.display = 'none'
    }
  }

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
        savePending(null)
        setOrderBtnVisible(true)
        return
      }
      el.textContent = 'Berlaku sisa ' + fmtTime(left) + ' (max 30 menit)'
    }
    tick()
    expiryTimer = setInterval(tick, 1000)
  }

  function hideCheckingOverlay() {
    var ov = document.getElementById('pay-check-overlay')
    if (ov) ov.remove()
  }

  function showCheckingOverlay() {
    hideCheckingOverlay()
    var ov = document.createElement('div')
    ov.id = 'pay-check-overlay'
    ov.className = 'pay-check-overlay'
    ov.innerHTML =
      '<div class="pay-check-card">' +
        '<div class="spinner center" style="font-size:32px;margin:0 auto 8px">' +
          '<div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div>' +
          '<div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div>' +
          '<div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div>' +
          '<div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div>' +
        '</div>' +
        '<p>Memeriksa status pembayaran...</p>' +
      '</div>'
    document.body.appendChild(ov)
  }

  function showUnpaidX() {
    hideCheckingOverlay()
    var ov = document.createElement('div')
    ov.id = 'pay-check-overlay'
    ov.className = 'pay-check-overlay'
    ov.innerHTML =
      '<div class="pay-check-card">' +
        '<div class="pay-x-circle" aria-hidden="true">' +
          '<svg viewBox="0 0 52 52" class="pay-check-svg">' +
            '<circle class="pay-x-bg" cx="26" cy="26" r="24" fill="none"/>' +
            '<path class="pay-x-mark" fill="none" d="M16 16 L36 36 M36 16 L16 36"/>' +
          '</svg>' +
        '</div>' +
        '<p class="pay-x-title">Pembayaran belum masuk</p>' +
        '<p class="pay-success-sub">Bayar dulu lalu cek lagi</p>' +
      '</div>'
    document.body.appendChild(ov)
    setTimeout(function () { hideCheckingOverlay() }, 2200)
  }

  function showPaidSuccess() {
    var box = document.querySelector('.qris-box') || document.getElementById('payment-info')
    if (!box) return
    box.innerHTML =
      '<div class="pay-success">' +
        '<div class="pay-check-circle" aria-hidden="true">' +
          '<svg viewBox="0 0 52 52" class="pay-check-svg">' +
            '<circle class="pay-check-bg" cx="26" cy="26" r="24" fill="none"/>' +
            '<path class="pay-check-mark" fill="none" d="M14 27 l8 8 16-16"/>' +
          '</svg>' +
        '</div>' +
        '<p class="pay-success-title">Pembayaran berhasil</p>' +
        '<p class="pay-success-sub">Premium aktif di akun Anda</p>' +
      '</div>'
    var actions = document.querySelector('.payment-actions')
    if (actions) actions.remove()
    var exp = document.getElementById('order-expiry')
    if (exp) exp.textContent = ''
    setOrderBtnVisible(false)
  }

  function payMethod() {
    return (document.getElementById('pay-method') && document.getElementById('pay-method').value) || 'qris'
  }

  function renderPayment(data) {
    var info = document.getElementById('payment-info')
    if (!info) return
    Z.show(info)
    setOrderBtnVisible(false)
    var p = data.payment || {}
    var method = (p.method || payMethod() || '').toLowerCase()
    var html = ''
    var payLink = p.redirect_url || p.payment_link || p.pending_url || null

    if (p.qr_string || p.qr_image) {
      var qrSrc = p.qr_image || ('https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(p.qr_string))
      html +=
        '<div class="qris-box">' +
          '<img id="qris-img" src="' + Z.escapeHtml(qrSrc) + '" alt="QRIS"/>' +
          '<p class="hint" style="margin:8px 0 0">Scan QRIS untuk bayar</p>' +
        '</div>'
    }

    html += '<div class="payment-actions">'
    if (p.qr_string || p.qr_image) {
      var qrSrc2 = p.qr_image || ('https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(p.qr_string))
      html += '<a class="btn outline" id="dl-qris" href="' + Z.escapeHtml(qrSrc2) + '" download="qris-zorabot.png" target="_blank" rel="noopener">' +
        '<i class="fa-solid fa-download"></i><span>Download QRIS</span></a>'
    }
    // Bayar Sekarang hanya untuk non-QRIS (DANA/GoPay/OVO/dll)
    var isQris = method === 'qris' || !!(p.qr_string || p.qr_image)
    if (!isQris && payLink && (method === 'dana' || method === 'gopay' || method === 'ovo' || method === 'linkaja' || method === 'shopeepay_idr')) {
      html += '<a class="btn primary" id="btn-pay-now" href="' + Z.escapeHtml(payLink) + '" target="_blank" rel="noopener">Bayar Sekarang</a>'
    }
    html += '<button type="button" class="btn outline" id="btn-check-pay">Cek Status</button>'
    html += '<button type="button" class="btn danger" id="btn-cancel-pay">Batalkan</button>'
    html += '</div>'

    if (p.account_number) {
      html += '<p style="margin-top:10px;text-align:center">No. rekening: <strong>' + Z.escapeHtml(p.account_number) + '</strong>' +
        (p.bank ? ' (' + Z.escapeHtml(p.bank) + ')' : '') + '</p>'
    }

    html += '<p class="hint" style="margin-top:10px;text-align:center">Total: Rp' + Number(data.amount || 0).toLocaleString('id-ID') + '</p>'
    html += '<p class="expiry-note" id="order-expiry"></p>'
    info.innerHTML = html

    startExpiryCountdown(data.expiresAt)

    var chk = document.getElementById('btn-check-pay')
    if (chk) chk.onclick = function () { doCheck(data.orderId) }
    var can = document.getElementById('btn-cancel-pay')
    if (can) can.onclick = function () { doCancel(data.orderId) }
  }

  async function loadPremium() {
    try {
      var data = await Z.api('/premium')
      var sub = data.subscription || {}
      var box = Z.$('#sub-status')
      if (box) {
        box.innerHTML = data.isPremium
          ? '<span class="badge premium">Premium</span> aktif sampai ' + (sub.expiresAt ? new Date(sub.expiresAt).toLocaleString('id-ID') : '-')
          : '<span class="badge free">Free</span> — upgrade untuk fitur lengkap'
      }
      if (data.isPremium) setOrderBtnVisible(false)
    } catch (e) {
      var box = Z.$('#sub-status')
      if (box) box.textContent = e.message
    }
  }

  async function doCheck(orderId) {
    var oid = orderId || (currentOrder && currentOrder.orderId)
    if (!oid) return
    var msg = Z.$('#upgrade-msg')
    showCheckingOverlay()
    try {
      var data = await Z.api('/premium/check', {
        method: 'POST', body: { orderId: oid }, timeoutMs: 25000
      })
      hideCheckingOverlay()
      if (data.status === 'paid') {
        if (msg) { msg.textContent = 'Pembayaran berhasil. Premium aktif!'; msg.className = 'msg ok' }
        showPaidSuccess()
        savePending(null)
        currentOrder = null
        await loadPremium()
      } else if (data.status === 'expired') {
        if (msg) { msg.textContent = data.message || 'Order kedaluwarsa'; msg.className = 'msg err' }
        savePending(null)
        setOrderBtnVisible(true)
      } else if (data.status === 'cancelled') {
        if (msg) { msg.textContent = 'Order dibatalkan'; msg.className = 'msg' }
        savePending(null)
        setOrderBtnVisible(true)
      } else {
        showUnpaidX()
        if (msg) { msg.textContent = 'Pembayaran belum masuk. Bayar dulu lalu cek lagi.'; msg.className = 'msg' }
      }
    } catch (e) {
      hideCheckingOverlay()
      if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
    }
  }

  async function doCancel(orderId) {
    var oid = orderId || (currentOrder && currentOrder.orderId)
    if (!oid) return
    if (!confirm('Batalkan transaksi ini?')) return
    var msg = Z.$('#upgrade-msg')
    try {
      await Z.api('/premium/cancel', { method: 'POST', body: { orderId: oid } })
      if (msg) { msg.textContent = 'Transaksi dibatalkan.'; msg.className = 'msg' }
      if (expiryTimer) clearInterval(expiryTimer)
      savePending(null)
      currentOrder = null
      var info = document.getElementById('payment-info')
      if (info) { info.innerHTML = ''; Z.hide(info) }
      setOrderBtnVisible(true)
    } catch (e) {
      if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
    }
  }

  function restorePending() {
    var pending = loadPending()
    if (!pending) {
      setOrderBtnVisible(true)
      return
    }
    currentOrder = pending
    renderPayment(pending)
    var msg = Z.$('#upgrade-msg')
    if (msg) {
      msg.textContent = 'Melanjutkan transaksi sebelumnya.'
      msg.className = 'msg'
    }
  }

  Z.bootPage(function () {
    loadPremium().then(function () {
      restorePending()
    })

    var orderBtn = Z.$('#order-premium-btn')
    if (orderBtn) orderBtn.onclick = async function () {
      var msg = Z.$('#upgrade-msg')
      if (msg) msg.textContent = ''
      var pending = loadPending()
      if (pending) {
        currentOrder = pending
        renderPayment(pending)
        if (msg) { msg.textContent = 'Masih ada transaksi aktif. Lanjutkan bayar.'; msg.className = 'msg' }
        return
      }
      orderBtn.classList.add('is-loading')
      orderBtn.disabled = true
      try {
        var data = await Z.api('/premium/order', {
          method: 'POST',
          body: { method: payMethod() },
          timeoutMs: 45000
        })
        currentOrder = data
        savePending(data)
        renderPayment(data)
        if (msg) { msg.textContent = 'Order dibuat. Bayar dalam 30 menit.'; msg.className = 'msg ok' }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
        setOrderBtnVisible(true)
      } finally {
        orderBtn.classList.remove('is-loading')
        orderBtn.disabled = false
      }
    }
  })
})()
