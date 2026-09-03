(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  var STATUS = {
    paid: 'Lunas',
    pending: 'Menunggu',
    expired: 'Kedaluwarsa',
    cancelled: 'Dibatalkan'
  }

  Z.bootPage(async function () {
    var wrap = Z.$('#orders-list')
    if (!wrap) return
    wrap.innerHTML = '<p class="hint">Memuat...</p>'
    try {
      var data = await Z.api('/orders', { timeoutMs: 12000 })
      var list = data.orders || []
      if (!list.length) {
        wrap.innerHTML = '<p class="hint">Belum ada order. <a href="/upgrade">Order Premium</a></p>'
        return
      }
      wrap.innerHTML = list.map(function (o) {
        var st = STATUS[o.status] || o.status
        var amt = Number(o.amount || 0).toLocaleString('id-ID')
        var t = o.createdAt ? new Date(o.createdAt).toLocaleString('id-ID') : ''
        return '<div class="order-card">' +
          '<div class="order-top">' +
            '<strong>Rp' + amt + '</strong>' +
            '<span class="badge ' + Z.escapeHtml(o.status) + '">' + Z.escapeHtml(st) + '</span>' +
          '</div>' +
          '<div class="order-meta">ID: ' + Z.escapeHtml(o.orderId || '') + '</div>' +
          '<div class="order-meta">Durasi: ' + Z.escapeHtml(o.duration || '-') + ' · ' + Z.escapeHtml(t) + '</div>' +
          '</div>'
      }).join('')
    } catch (e) {
      wrap.innerHTML = '<p class="error">' + Z.escapeHtml(e.message) + '</p>'
    }
  })
})()
