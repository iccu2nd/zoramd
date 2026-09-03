(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  function esc(s) { return Z.escapeHtml(s) }

  var pluginsCache = []

  async function load() {
    try {
      var me = await Z.api('/auth/me', { timeoutMs: 8000 })
      Z.state.user = me.user
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
      var data = await Z.api('/admin/shared-features', { timeoutMs: 20000 })
      pluginsCache = data.plugins || []
      var sel = document.getElementById('sf-plugin')
      if (sel) {
        sel.innerHTML = '<option value="">— pilih command —</option>' +
          pluginsCache.map(function (p) {
            return '<option value="' + esc(p.featureKey) + '" data-cat="' + esc(p.category) + '" data-desc="' + esc(p.description || '') + '">' +
              esc(p.featureKey) + ' (' + esc(p.category) + ')</option>'
          }).join('')
        sel.onchange = function () {
          var opt = sel.options[sel.selectedIndex]
          if (!opt || !opt.value) return
          var titleEl = document.getElementById('sf-title')
          var descEl = document.getElementById('sf-desc')
          if (titleEl && !titleEl.value) titleEl.value = opt.value
          if (descEl && !descEl.value) descEl.value = opt.getAttribute('data-desc') || ''
        }
      }

      var list = document.getElementById('sf-list')
      var shared = data.shared || []
      if (list) {
        list.innerHTML = shared.length ? shared.map(function (s) {
          return '<div class="bot-card"><div><h3>' + esc(s.title || s.featureKey) + '</h3>' +
            '<div class="bot-meta">.' + esc(s.featureKey) + ' · ' + esc(s.category || '') +
            (s.active === false ? ' · nonaktif' : '') + '</div>' +
            (s.description ? '<div class="bot-meta">' + esc(s.description) + '</div>' : '') +
            '</div><button type="button" class="btn danger btn-sm sf-del" data-key="' + esc(s.featureKey) + '">Hapus</button></div>'
        }).join('') : '<p class="hint">Belum ada fitur di katalog.</p>'

        list.querySelectorAll('.sf-del').forEach(function (btn) {
          btn.onclick = async function () {
            if (!confirm('Hapus dari katalog?')) return
            try {
              await Z.api('/admin/shared-features/' + encodeURIComponent(btn.dataset.key), { method: 'DELETE' })
              load()
            } catch (e) { alert(e.message) }
          }
        })
      }
    } catch (e) {
      alert(e.message || 'Gagal memuat')
    }
  }

  Z.bootPage(async function () {
    await load()
    var addBtn = document.getElementById('sf-add')
    if (addBtn) addBtn.onclick = async function () {
      var msg = document.getElementById('sf-msg')
      var key = (document.getElementById('sf-plugin') || {}).value
      var title = (document.getElementById('sf-title') || {}).value
      var desc = (document.getElementById('sf-desc') || {}).value
      var opt = document.getElementById('sf-plugin')
      var cat = 'others'
      if (opt && opt.selectedIndex >= 0) {
        cat = opt.options[opt.selectedIndex].getAttribute('data-cat') || 'others'
      }
      if (!key) {
        if (msg) { msg.textContent = 'Pilih plugin dulu'; msg.className = 'msg err' }
        return
      }
      try {
        await Z.api('/admin/shared-features', {
          method: 'POST',
          body: { featureKey: key, title: title || key, description: desc || '', category: cat, active: true }
        })
        if (msg) { msg.textContent = 'Tersimpan di katalog'; msg.className = 'msg ok' }
        if (document.getElementById('sf-title')) document.getElementById('sf-title').value = ''
        if (document.getElementById('sf-desc')) document.getElementById('sf-desc').value = ''
        load()
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
      }
    }
  })
})()
