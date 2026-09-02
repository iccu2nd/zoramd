(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  Z.bootPage(async function () {
    var plan = 'free'
    try {
      var prem = await Z.api('/premium')
      if (prem.isPremium) plan = 'premium'
    } catch (e) {}

    if (Z.state.user && Z.state.user.isAdmin) {
      var n = document.getElementById('nav-admin')
      if (n) n.classList.remove('hidden')
    }
    var el = Z.$('#account-info')
    if (!el) return
    var u = Z.state.user || {}
    var limits = Z.state.limits || { plan: 'free', max: 1, used: 0 }
    if (plan !== 'premium') {
      var limits = Z.state.limits || { plan: 'free' }
      plan = limits.plan === 'premium' ? 'premium' : 'free'
    }

    el.innerHTML =
      '<p><strong>Email</strong><br/>' + Z.escapeHtml(u.email || '-') + '</p>' +
      '<p style="margin-top:14px"><strong>Nama</strong><br/>' + Z.escapeHtml(u.name || '-') + '</p>' +
      '<p style="margin-top:14px"><strong>User ID</strong><br/><code>' + Z.escapeHtml(u.id || '-') + '</code></p>' +
      '<p style="margin-top:14px"><strong>Plan</strong></p>' +
      '<span class="plan-pill ' + plan + '">' + (plan === 'premium' ? 'Premium' : 'Free') + '</span>' +
      '<p class="hint" style="margin-top:10px">Bot: ' + (limits.used || (Z.state.bots || []).length) +
      ' / ' + (plan === 'premium' ? 3 : 1) +
      (plan !== 'premium' ? ' · <a href="/upgrade">Upgrade Premium</a>' : '') + '</p>'
  })
})()
