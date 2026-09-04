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
      if (!data || !data.orderId) {
        localStorage.removeItem(STORAGE_KEY)
        return null
      }
      var now = Date.now()
      var exp = data.expiresAt ? new Date(data.expiresAt).getTime() : 0
      // expired by server deadline
      if (exp && exp < now) {
        localStorage.removeItem(STORAGE_KEY)
        return null
      }
      // fallback: max 30 menit dari savedAt
      var saved = data.savedAt || 0
      if (saved && (now - saved) > 30 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY)
        return null
      }
      // expiresAt invalid / missing → treat as expired if older than 30m, else keep with synthetic deadline
      if (!exp || isNaN(exp)) {
        if (saved && (now - saved) > 30 * 60 * 1000) {
          localStorage.removeItem(STORAGE_KEY)
          return null
        }
        data.expiresAt = new Date((saved || now) + 30 * 60 * 1000).toISOString()
      }
      return data
    } catch (e) {
      try { localStorage.removeItem(STORAGE_KEY) } catch (e2) {}
      return null
    }
  }

  function setOrderBtnVisible(show) {
    var btn = document.getElementById('order-premium-btn')
    var details = document.getElementById('plan-details')
    if (btn) {
      if (show) {
        btn.classList.remove('hidden')
        btn.style.display = ''
      } else {
        btn.classList.add('hidden')
        btn.style.display = 'none'
      }
    }
    if (details) details.style.display = show ? '' : 'none'
  }

  function fmtTime(ms) {
    if (ms <= 0) return '00:00'
    var m = Math.floor(ms / 60000)
    var s = Math.floor((ms % 60000) / 1000)
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
  }

  function fmtClock(d) {
    var hh = d.getHours()
    var mm = d.getMinutes()
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
  }

  function startExpiryCountdown(expiresAt) {
    if (expiryTimer) clearInterval(expiryTimer)
    var el = document.getElementById('order-expiry')
    if (!el || !expiresAt) return
    var deadline = new Date(expiresAt)
    var deadlineStr = fmtClock(deadline)
    function tick() {
      var left = deadline.getTime() - Date.now()
      if (left <= 0) {
        el.textContent = 'Order kedaluwarsa. Buat order baru.'
        clearInterval(expiryTimer)
        savePending(null)
        currentOrder = null
        var info = document.getElementById('payment-info')
        if (info) { info.innerHTML = ''; Z.hide(info) }
        setOrderBtnVisible(true)
        var msg = Z.$('#upgrade-msg')
        if (msg) { msg.textContent = 'Order kedaluwarsa. Silakan buat order baru.'; msg.className = 'msg err' }
        return
      }
      el.textContent = 'Bayar sebelum jam ' + deadlineStr + ' (sisa ' + fmtTime(left) + ')'
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
        '<div class="spinner center" style="font-size:32px;margin:0 auto 8px"></div>' +
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
    return 'qris'
  }

  var PLAN_PRICES = { '7d': { price: 5000, label: '7 hari' }, '30d': { price: 15000, label: '30 hari' } }
  function planDuration() {
    return (document.getElementById('plan-duration') && document.getElementById('plan-duration').value) || '30d'
  }
  function updatePlanPrice() {
    var p = PLAN_PRICES[planDuration()] || PLAN_PRICES['30d']
    var el = document.getElementById('plan-price')
    if (el) el.innerHTML = 'Rp' + p.price.toLocaleString('id-ID') + ' <span>/ ' + p.label + '</span>'
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

    html += '<p class="hint" style="margin-top:10px;text-align:center;font-weight:600">Total bayar: Rp' + Number(data.amount || data.baseAmount || 0).toLocaleString('id-ID') + '</p>'
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
        Z.toast('Pembayaran berhasil. Premium aktif.', 'success')
        showPaidSuccess()
        savePending(null)
        currentOrder = null
        await loadPremium()
      } else if (data.status === 'expired') {
        if (msg) { msg.textContent = data.message || 'Order kedaluwarsa'; msg.className = 'msg err' }
        Z.toast(data.message || 'Order kedaluwarsa.', 'error')
        savePending(null)
        setOrderBtnVisible(true)
      } else if (data.status === 'cancelled') {
        if (msg) { msg.textContent = 'Order dibatalkan'; msg.className = 'msg' }
        Z.toast('Order dibatalkan.', 'info')
        savePending(null)
        setOrderBtnVisible(true)
      } else {
        showUnpaidX()
        if (msg) { msg.textContent = 'Pembayaran belum masuk. Bayar dulu lalu cek lagi.'; msg.className = 'msg' }
        Z.toast('Pembayaran belum masuk. Silakan cek lagi setelah membayar.', 'warning')
      }
    } catch (e) {
      hideCheckingOverlay()
      if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
      Z.toast(e.message, 'error')
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
      Z.toast('Transaksi berhasil dibatalkan.', 'success')
      if (expiryTimer) clearInterval(expiryTimer)
      savePending(null)
      currentOrder = null
      var info = document.getElementById('payment-info')
      if (info) { info.innerHTML = ''; Z.hide(info) }
      setOrderBtnVisible(true)
    } catch (e) {
      if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
      Z.toast(e.message, 'error')
    }
  }

  async function restorePending() {
    var pending = loadPending()
    if (!pending) {
      setOrderBtnVisible(true)
      return
    }
    // Pastikan order di server masih pending (bukan expired/cancelled/paid)
    try {
      var st = await Z.api('/premium/check', {
        method: 'POST',
        body: { orderId: pending.orderId },
        timeoutMs: 15000
      })
      if (st.status === 'paid') {
        savePending(null)
        currentOrder = null
        setOrderBtnVisible(false)
        var msgOk = Z.$('#upgrade-msg')
        if (msgOk) { msgOk.textContent = 'Premium sudah aktif.'; msgOk.className = 'msg ok' }
        await loadPremium()
        return
      }
      if (st.status === 'expired' || st.status === 'cancelled') {
        savePending(null)
        currentOrder = null
        setOrderBtnVisible(true)
        var info = document.getElementById('payment-info')
        if (info) { info.innerHTML = ''; Z.hide(info) }
        var msgE = Z.$('#upgrade-msg')
        if (msgE) {
          msgE.textContent = st.status === 'expired'
            ? (st.message || 'Order sebelumnya sudah kedaluwarsa. Buat order baru.')
            : 'Order sebelumnya dibatalkan. Buat order baru.'
          msgE.className = 'msg err'
        }
        return
      }
    } catch (e) {
      // network error: tetap tampilkan pending lokal jika belum lewat expiresAt
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
    updatePlanPrice()
    var dur = Z.$('#plan-duration')
    if (dur) dur.onchange = updatePlanPrice
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
          body: { method: payMethod(), duration: planDuration() },
          timeoutMs: 45000
        })
        currentOrder = data
        savePending(data)
        renderPayment(data)
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
