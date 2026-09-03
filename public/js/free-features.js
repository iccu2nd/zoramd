(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  function esc(s) { return Z.escapeHtml(s) }

  async function loadCatalog() {
    var botId = Z.$('#ff-bot-select') && Z.$('#ff-bot-select').value
    var wrap = Z.$('#ff-list')
    var msg = Z.$('#ff-msg')
    if (!wrap) return
    if (!botId) {
      wrap.innerHTML = '<p class="hint">Belum ada bot. Connect bot dulu di menu Connect.</p>'
      return
    }
    wrap.innerHTML = '<p class="hint">Memuat katalog...</p>'
    try {
      var data = await Z.api('/bots/' + botId + '/shared-features', { timeoutMs: 15000 })
      var list = data.features || []
      if (!list.length) {
        wrap.innerHTML = '<p class="hint">Belum ada fitur gratis yang dishare. Tunggu owner menambahkan di katalog.</p>'
        return
      }
      var byCat = {}
      list.forEach(function (f) {
        var c = f.category || 'others'
        if (!byCat[c]) byCat[c] = []
        byCat[c].push(f)
      })
      wrap.innerHTML = Object.keys(byCat).sort().map(function (cat) {
        return '<div class="feat-group open" data-cat="' + esc(cat) + '">' +
          '<button type="button" class="feat-group-head">' +
          '<span class="feat-group-title">' + esc(cat) + '</span>' +
          '<span class="feat-group-meta">' + byCat[cat].length + ' fitur</span>' +
          '<span class="feat-group-chevron">▸</span></button>' +
          '<div class="feat-group-body">' + byCat[cat].map(function (f) {
            return '<div class="feature-item" data-key="' + esc(f.featureKey) + '">' +
              '<div class="feature-row"><div class="feature-info">' +
              '<span class="name">' + esc(f.title || f.featureKey) + '</span>' +
              (f.description ? '<span class="desc">' + esc(f.description) + '</span>' : '') +
              '<span class="field-hint">Command: <code>.' + esc(f.featureKey) + '</code></span>' +
              '</div>' +
              (f.added
                ? '<button type="button" class="btn outline btn-sm ff-remove">Lepas</button>'
                : '<button type="button" class="btn primary btn-sm ff-add">Tambah</button>') +
              '</div></div>'
          }).join('') + '</div></div>'
      }).join('')

      wrap.querySelectorAll('.feat-group-head').forEach(function (btn) {
        btn.onclick = function () { btn.closest('.feat-group').classList.toggle('open') }
      })
      wrap.querySelectorAll('.ff-add').forEach(function (btn) {
        btn.onclick = async function () {
          var item = btn.closest('.feature-item')
          var key = item && item.dataset.key
          if (!key) return
          btn.disabled = true
          try {
            await Z.api('/bots/' + botId + '/shared-features/' + encodeURIComponent(key) + '/add', { method: 'POST', body: {} })
            if (msg) { msg.textContent = 'Fitur ditambahkan ke bot.'; msg.className = 'msg ok' }
            loadCatalog()
          } catch (e) {
            alert(e.message)
            btn.disabled = false
          }
        }
      })
      wrap.querySelectorAll('.ff-remove').forEach(function (btn) {
        btn.onclick = async function () {
          var item = btn.closest('.feature-item')
          var key = item && item.dataset.key
          if (!key) return
          if (!confirm('Lepas fitur ini dari bot?')) return
          btn.disabled = true
          try {
            await Z.api('/bots/' + botId + '/shared-features/' + encodeURIComponent(key) + '/remove', { method: 'POST', body: {} })
            if (msg) { msg.textContent = 'Fitur dilepas dari bot.'; msg.className = 'msg ok' }
            loadCatalog()
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
    Z.fillBotSelect('ff-bot-select')
    loadCatalog()
    var sel = Z.$('#ff-bot-select')
    if (sel) sel.onchange = loadCatalog
  })
})()
