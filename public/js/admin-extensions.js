(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  function esc(s) { return Z.escapeHtml(s) }

  async function load() {
    try {
      var me = await Z.api('/auth/me', { timeoutMs: 8000 })
      if (!me.user || !me.user.isAdmin) {
        alert('Akses admin saja')
        location.replace('/dashboard')
        return
      }
    } catch (e) {
      location.replace('/dashboard')
      return
    }

    try {
      var data = await Z.api('/admin/extensions', { timeoutMs: 15000 })
      var list = document.getElementById('ext-admin-list')
      var items = data.plugins || []
      if (!list) return
      list.innerHTML = items.length ? items.map(function (s) {
        return '<div class="bot-card"><div><h3>' + esc(s.title || s.featureKey) + '</h3>' +
          '<div class="bot-meta">.' + esc(s.featureKey) + ' · ' + esc(s.category || '') +
          (s.active === false ? ' · nonaktif' : '') + '</div>' +
          (s.description ? '<div class="bot-meta">' + esc(s.description) + '</div>' : '') +
          '</div><button type="button" class="btn danger btn-sm ext-del" data-key="' + esc(s.featureKey) + '">Hapus</button></div>'
      }).join('') : '<p class="hint">Belum ada ekstensi.</p>'

      list.querySelectorAll('.ext-del').forEach(function (btn) {
        btn.onclick = async function () {
          if (!confirm('Hapus ekstensi ini?')) return
          try {
            await Z.api('/admin/extensions/' + encodeURIComponent(btn.dataset.key), { method: 'DELETE' })
            load()
          } catch (e) { alert(e.message) }
        }
      })
    } catch (e) {
      alert(e.message || 'Gagal memuat')
    }
  }

  Z.bootPage(async function () {
    await load()
    var btn = document.getElementById('ext-publish')
    if (!btn) return
    btn.onclick = async function () {
      var msg = document.getElementById('ext-msg')
      var body = {
        featureKey: (document.getElementById('ext-key') || {}).value,
        title: (document.getElementById('ext-title') || {}).value,
        description: (document.getElementById('ext-desc') || {}).value,
        category: (document.getElementById('ext-cat') || {}).value || 'ekstensi',
        code: (document.getElementById('ext-code') || {}).value,
        active: true
      }
      if (!body.featureKey || !body.code) {
        if (msg) { msg.textContent = 'Key dan kode wajib diisi'; msg.className = 'msg err' }
        return
      }
      btn.disabled = true
      try {
        await Z.api('/admin/extensions', { method: 'POST', body: body, timeoutMs: 20000 })
        if (msg) { msg.textContent = 'Ekstensi dipublish'; msg.className = 'msg ok' }
        load()
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
      } finally {
        btn.disabled = false
      }
    }
  })
})()
