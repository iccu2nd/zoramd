(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  var toggleRestartTimer = null
  function scheduleRestart(botId) {
    if (toggleRestartTimer) clearTimeout(toggleRestartTimer)
    toggleRestartTimer = setTimeout(function () {
      Z.restartBot(botId).catch(function () {})
    }, 1200)
  }
  var CAT_LABEL = {
    main: 'Main', tools: 'Tools', group: 'Group', downloader: 'Downloader',
    games: 'Games', game: 'Games', fun: 'Fun', info: 'Info', owner: 'Owner',
    rpg: 'RPG', owo: 'OwO', social: 'Social', maker: 'Maker', image: 'Image',
    nsfw: 'NSFW', donasi: 'Donasi', others: 'Lainnya'
  }
  function catLabel(c) { return CAT_LABEL[c] || (c.charAt(0).toUpperCase() + c.slice(1)) }

  function featureRow(f, isPremium) {
    var key = f.featureKey
    var rules = [['owner','Owner Only'],['group','Group Only'],['owner_group','Owner + Group'],['public','Public']]
    return '<div class="feature-item" data-key="' + Z.escapeHtml(key) + '">' +
      '<div class="feature-row"><div class="feature-info"><span class="name">' + Z.escapeHtml(key) + '</span>' +
      (f.description ? '<span class="desc">' + Z.escapeHtml(String(f.description).slice(0, 80)) + '</span>' : '') +
      '</div><label class="switch"><input type="checkbox" class="feat-enabled" ' +
      (f.enabled !== false ? 'checked' : '') + '/><span class="slider"></span></label></div>' +
      '<div class="feature-detail"><div class="field"><label>Access Rule</label><select class="feat-access" ' +
      (isPremium ? '' : 'disabled') + '>' +
      rules.map(function (r) {
        return '<option value="' + r[0] + '"' + (f.accessRule === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'
      }).join('') +
      '</select></div><div class="field"><label>Custom Response</label>' +
      '<input class="feat-response" type="text" value="' + Z.escapeHtml(f.customResponse || '') + '" ' +
      (isPremium ? '' : 'disabled') + ' placeholder="Kosongkan = default"/></div>' +
      '<div class="field"><label>Custom Command</label>' +
      '<input class="feat-command" type="text" value="' + Z.escapeHtml(f.customCommand || '') + '" ' +
      (isPremium ? '' : 'disabled') + ' placeholder="Kosongkan = default"/>' +
      '<span class="field-hint">Default: ' + Z.escapeHtml((f.aliases && f.aliases.length ? f.aliases : [key]).join(', ')) + '</span>' +
      '</div>' +
      '<div class="row gap"><button type="button" class="btn outline feat-save">Simpan</button>' +
      '<span class="feat-saved msg ok"></span></div></div></div>'
  }

  async function loadFeatures() {
    var botId = Z.$('#feature-bot-select') && Z.$('#feature-bot-select').value
    var wrap = Z.$('#features-list')
    if (!wrap) return
    if (!botId) {
      wrap.innerHTML = '<p class="hint">Belum ada bot tersambung.</p>'
      return
    }
    wrap.innerHTML = '<div class="panel-loading"><div class="spinner center" aria-hidden="true">' +
      '<div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div>' +
      '<div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div>' +
      '<div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div><div class="spinner-blade"></div>' +
      '</div></div>'
    try {
      var data = await Z.api('/bots/' + botId + '/features', { timeoutMs: 15000 })
      var groups = data.groups || {}
      var cats = data.categories || Object.keys(groups)
      if (!cats.length) {
        wrap.innerHTML = '<p class="hint">Belum ada plugin ter-load.</p>'
        return
      }
      wrap.innerHTML = cats.map(function (cat) {
        var items = groups[cat] || []
        var onCount = items.filter(function (f) { return f.enabled !== false }).length
        return '<div class="feat-group" data-cat="' + Z.escapeHtml(cat) + '">' +
          '<button type="button" class="feat-group-head">' +
          '<span class="feat-group-title">' + Z.escapeHtml(catLabel(cat)) + '</span>' +
          '<span class="feat-group-meta">' + onCount + '/' + items.length + ' aktif</span>' +
          '<span class="feat-group-chevron">▸</span></button>' +
          '<div class="feat-group-body">' + items.map(function (f) { return featureRow(f, data.isPremium) }).join('') +
          '</div></div>'
      }).join('')

      wrap.querySelectorAll('.feat-group').forEach(function (g) {
        g.querySelector('.feat-group-head').onclick = function () { g.classList.toggle('open') }
      })
      wrap.querySelectorAll('.feature-item').forEach(function (item) {
        var en = item.querySelector('.feat-enabled')
        if (en) en.onchange = async function (e) {
          try {
            await Z.api('/bots/' + botId + '/features/' + item.dataset.key, {
              method: 'PUT', body: { enabled: e.target.checked }
            })
            var group = item.closest('.feat-group')
            var on = group.querySelectorAll('.feat-enabled:checked').length
            var total = group.querySelectorAll('.feat-enabled').length
            group.querySelector('.feat-group-meta').textContent = on + '/' + total + ' aktif'
            scheduleRestart(botId)
          } catch (err) { alert(err.message) }
        }
        var save = item.querySelector('.feat-save')
        if (save) save.onclick = async function () {
          try {
            await Z.api('/bots/' + botId + '/features/' + item.dataset.key, {
              method: 'PUT',
              body: {
                enabled: item.querySelector('.feat-enabled').checked,
                accessRule: (item.querySelector('.feat-access') || {}).value || 'public',
                customResponse: (item.querySelector('.feat-response') || {}).value || null,
                customCommand: (item.querySelector('.feat-command') || {}).value || null
              }
            })
            var msg = item.querySelector('.feat-saved')
            if (msg) { msg.textContent = 'Tersimpan...'; }
            try { await Z.restartBot(botId); if (msg) msg.textContent = 'Tersimpan' } catch (e) {}
            setTimeout(function () { if (msg) msg.textContent = '' }, 1500)
          } catch (err) { alert(err.message) }
        }
      })
    } catch (e) {
      wrap.innerHTML = '<p class="error">' + Z.escapeHtml(e.message) + '</p>'
    }
  }

  Z.bootPage(function () {
    Z.fillBotSelect('feature-bot-select')
    loadFeatures()
    var sel = Z.$('#feature-bot-select')
    if (sel) sel.onchange = loadFeatures
  })
})()
