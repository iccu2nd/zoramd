(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  Z.bootPage(function () {
    var el = Z.$('#account-info')
    if (!el) return
    var u = Z.state.user || {}
    el.innerHTML = '<p><strong>Email</strong><br/>' + Z.escapeHtml(u.email || '-') +
      '</p><p style="margin-top:12px"><strong>Nama</strong><br/>' + Z.escapeHtml(u.name || '-') +
      '</p><p style="margin-top:12px"><strong>User ID</strong><br/>' + Z.escapeHtml(u.id || '-') + '</p>'
  })
})()
