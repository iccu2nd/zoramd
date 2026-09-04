(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  var STATUS = {
    pending: 'Pending',
    paid: 'Paid',
    expired: 'Expired',
    cancelled: 'Cancelled'
  }

  async function loadOrders() {
    var wrap = Z.$('#orders-list')
    if (!wrap) return
    wrap.innerHTML = '<p class="hint">Loading...</p>'
    try {
      var data = await Z.api('/orders', { timeoutMs: 12000 })
      var list = data.orders || []
      if (!list.length) {
        wrap.innerHTML = '<p class="hint">No orders yet. <a href="/upgrade">Upgrade Plan</a></p>'
        return
      }
      wrap.innerHTML = list.map(function (o) {
        var st = STATUS[o.status] || o.status
        var amt = Number(o.amount || 0).toLocaleString('en-US')
        var t = o.createdAt ? new Date(o.createdAt).toLocaleString() : ''
        return '<div class="order-card" data-id="' + Z.escapeHtml(o.orderId || '') + '">' +
          '<div class="order-top">' +
            '<strong>Rp' + amt + '</strong>' +
            '<span class="badge ' + Z.escapeHtml(o.status) + '">' + Z.escapeHtml(st) + '</span>' +
          '</div>' +
          '<div class="order-meta">ID: ' + Z.escapeHtml(o.orderId || '') + '</div>' +
          '<div class="order-meta">Duration: ' + Z.escapeHtml(o.duration || '-') + ' · ' + Z.escapeHtml(t) + '</div>' +
          '<div class="order-actions" style="margin-top:10px">' +
            '<button type="button" class="btn outline btn-sm order-delete">Delete</button>' +
          '</div>' +
          '</div>'
      }).join('')
      wrap.querySelectorAll('.order-delete').forEach(function (btn) {
        btn.onclick = async function () {
          var card = btn.closest('.order-card')
          var id = card && card.dataset.id
          if (!id) return
          if (!confirm('Delete this transaction permanently?')) return
          try {
            await Z.api('/orders/' + encodeURIComponent(id), { method: 'DELETE' })
            Z.toast('Transaction deleted successfully.', 'success')
            loadOrders()
          } catch (e) { Z.toast(e.message, 'error') }
        }
      })
    } catch (e) {
      wrap.innerHTML = '<p class="error">' + Z.escapeHtml(e.message) + '</p>'
    }
  }

  Z.bootPage(function () { loadOrders() })
})()
