(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  function render(plan) {
    var el = Z.$('#account-info')
    if (!el) return
    var u = Z.state.user || {}
    plan = plan || (Z.state.limits && Z.state.limits.plan) || 'free'
    el.innerHTML =
      '<p><strong>Email</strong><br/>' + Z.escapeHtml(u.email || '-') + '</p>' +
      '<p style="margin-top:14px"><strong>Nama</strong><br/>' + Z.escapeHtml(u.name || '-') + '</p>' +
      '<p style="margin-top:14px"><strong>User ID</strong><br/><code>' + Z.escapeHtml(u.id || '-') + '</code></p>' +
      '<p style="margin-top:14px"><strong>Plan</strong></p>' +
      '<span class="plan-pill ' + plan + '">' + (plan === 'premium' ? 'Premium' : 'Free') + '</span>'
    renderVerify()
  }

  function renderVerify() {
    var el = Z.$('#email-verify-card')
    if (!el) return
    var u = Z.state.user || {}
    if (u.emailVerified) {
      el.innerHTML = '<p><i class="fa-solid fa-circle-check" style="color:#22c55e"></i> Email sudah terverifikasi</p>'
      return
    }
    el.innerHTML =
      '<p><i class="fa-solid fa-circle-exclamation" style="color:#eab308"></i> Email belum diverifikasi</p>' +
      '<button type="button" class="btn outline" id="verify-request-btn" style="margin-top:10px">Send verification code</button>' +
      '<div id="verify-code-wrap" class="hidden" style="margin-top:12px">' +
      '  <label>OTP code (sent to your email)</label>' +
      '  <input type="text" id="verify-code-input" inputmode="numeric" maxlength="6" />' +
      '  <button type="button" class="btn primary" id="verify-confirm-btn" style="margin-top:10px">Konfirmasi</button>' +
      '</div>' +
      '<p id="verify-error" class="error"></p>' +
      '<p id="verify-notice" class="auth-notice hidden"></p>'

    Z.$('#verify-request-btn').onclick = async function () {
      var btn = Z.$('#verify-request-btn')
      btn.disabled = true
      Z.$('#verify-error').textContent = ''
      try {
        await Z.api('/auth/verify-email/request', { method: 'POST', timeoutMs: 8000 })
        Z.show(Z.$('#verify-code-wrap'))
        var notice = Z.$('#verify-notice')
        notice.textContent = 'A code was sent to your email.'
        Z.show(notice)
      } catch (e) {
        Z.$('#verify-error').textContent = e.message
      } finally {
        btn.disabled = false
      }
    }

    Z.$('#verify-confirm-btn').onclick = async function () {
      var btn = Z.$('#verify-confirm-btn')
      btn.disabled = true
      Z.$('#verify-error').textContent = ''
      try {
        var code = Z.$('#verify-code-input').value.trim()
        await Z.api('/auth/verify-email/confirm', { method: 'POST', body: { code: code }, timeoutMs: 8000 })
        Z.state.user.emailVerified = true
        try { localStorage.setItem('zora_user', JSON.stringify(Z.state.user)) } catch (e) {}
        renderVerify()
      } catch (e) {
        Z.$('#verify-error').textContent = e.message
        btn.disabled = false
      }
    }
  }

  Z.bootPage(async function () {
    if (Z.state.user && Z.state.user.isAdmin) {
      var n = document.getElementById('nav-admin')
      if (n) n.classList.remove('hidden')
    }
    // Render instan dari cache
    render((Z.state.limits && Z.state.limits.plan) || 'free')
    // Ambil status emailVerified terbaru (cache lama mungkin belum punya field ini)
    try {
      var me = await Z.api('/auth/me', { timeoutMs: 8000 })
      Z.state.user = me.user
      try { localStorage.setItem('zora_user', JSON.stringify(me.user)) } catch (e) {}
      renderVerify()
    } catch (e) {}
    // Update plan dari server (tanpa kosongin UI)
    try {
      var prem = await Z.api('/premium', { timeoutMs: 8000 })
      render(prem.isPremium ? 'premium' : 'free')
    } catch (e) {}
  })
})()
