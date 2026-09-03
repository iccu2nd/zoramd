(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  function esc(s) { return Z.escapeHtml(s) }

  async function loadList() {
    var botId = Z.$('#ext-bot-select') && Z.$('#ext-bot-select').value
    var wrap = Z.$('#ext-list')
    var msg = Z.$('#ext-msg')
    if (!wrap) return
    if (!botId) {
      wrap.innerHTML = '<p class="hint">Belum ada bot. Connect bot dulu.</p>'
      return
    }
    wrap.innerHTML = '<p class="hint">Memuat...</p>'
    try {
      var data = await Z.api('/bots/' + botId + '/extensions', { timeoutMs: 15000 })
      var list = data.plugins || []
      if (!list.length) {
        wrap.innerHTML = '<p class="hint">Belum ada ekstensi dipublikasikan. Tunggu admin mengunggah plugin baru.</p>'
        return
      }
      wrap.innerHTML = list.map(function (f) {
        return '<div class="feature-item" data-key="' + esc(f.featureKey) + '">' +
          '<div class="feature-row"><div class="feature-info">' +
          '<span class="name">' + esc(f.title || f.featureKey) + '</span>' +
          (f.description ? '<span class="desc">' + esc(f.description) + '</span>' : '') +
          '<span class="field-hint">Command: <code>.' + esc(f.featureKey) + '</code>' +
          (f.category ? ' · ' + esc(f.category) : '') + '</span>' +
          '</div>' +
          (f.installed
            ? '<button type="button" class="btn outline btn-sm ext-off">Lepas</button>'
            : '<button type="button" class="btn primary btn-sm ext-on">Pasang</button>') +
          '</div></div>'
      }).join('')

      wrap.querySelectorAll('.ext-on').forEach(function (btn) {
        btn.onclick = async function () {
          var key = btn.closest('.feature-item').dataset.key
          btn.disabled = true
          try {
            await Z.api('/bots/' + botId + '/extensions/' + encodeURIComponent(key) + '/install', { method: 'POST', body: {} })
            if (msg) { msg.textContent = 'Ekstensi terpasang.'; msg.className = 'msg ok' }
            loadList()
          } catch (e) {
            alert(e.message)
            btn.disabled = false
          }
        }
      })
      wrap.querySelectorAll('.ext-off').forEach(function (btn) {
        btn.onclick = async function () {
          var key = btn.closest('.feature-item').dataset.key
          if (!confirm('Lepas ekstensi ini dari bot?')) return
          btn.disabled = true
          try {
            await Z.api('/bots/' + botId + '/extensions/' + encodeURIComponent(key) + '/uninstall', { method: 'POST', body: {} })
            if (msg) { msg.textContent = 'Ekstensi dilepas.'; msg.className = 'msg ok' }
            loadList()
          } catch (e) {
            alert(e.message)
            btn.disabled = false
          }
        }
      })
    } catch (e) {
      wrap.innerHTML = '<p class="error">' + esc(e.message) + '</p>'
    }
  }

  Z.bootPage(function () {
    Z.fillBotSelect('ext-bot-select')
    loadList()
    var sel = Z.$('#ext-bot-select')
    if (sel) sel.onchange = loadList
  })
})()
