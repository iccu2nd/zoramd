(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  function render(plan) {
    var el = Z.$('#account-info')
    if (!el) return
    var u = Z.state.user || {}
    var limits = Z.state.limits || { plan: 'free', max: 1, used: 0 }
    plan = plan || limits.plan || 'free'
    var maxB = plan === 'premium' ? 3 : 1
    var used = limits.used != null ? limits.used : (Z.state.bots || []).length
    el.innerHTML =
      '<p><strong>Email</strong><br/>' + Z.escapeHtml(u.email || '-') + '</p>' +
      '<p style="margin-top:14px"><strong>Nama</strong><br/>' + Z.escapeHtml(u.name || '-') + '</p>' +
      '<p style="margin-top:14px"><strong>User ID</strong><br/><code>' + Z.escapeHtml(u.id || '-') + '</code></p>' +
      '<p style="margin-top:14px"><strong>Plan</strong></p>' +
      '<span class="plan-pill ' + plan + '">' + (plan === 'premium' ? 'Premium' : 'Free') + '</span>' +
      '<p class="hint" style="margin-top:10px">Bot: ' + used + ' / ' + maxB +
      (plan !== 'premium' ? ' · <a href="/upgrade">Upgrade Premium</a>' : '') + '</p>'
  }

  Z.bootPage(async function () {
    if (Z.state.user && Z.state.user.isAdmin) {
      var n = document.getElementById('nav-admin')
      if (n) n.classList.remove('hidden')
    }
    // Render instan dari cache
    render((Z.state.limits && Z.state.limits.plan) || 'free')
    // Update plan dari server (tanpa kosongin UI)
    try {
      var prem = await Z.api('/premium', { timeoutMs: 8000 })
      render(prem.isPremium ? 'premium' : 'free')
    } catch (e) {}
  })
})()
