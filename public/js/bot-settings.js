(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  async function doRestart(botId) {
    if (!botId) return Z.toast('Pilih bot terlebih dahulu.', 'warning')
    try {
      await Z.restartBot(botId)
      Z.toast('Bot berhasil di-restart.', 'success')
    } catch (e) { Z.toast(e.message, 'error') }
  }

  async function loadErrors() {
    var botId = Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value
    var list = Z.$('#settings-err-list')
    if (!list) return
    if (!botId) {
      list.innerHTML = '<p class="hint">Pilih bot untuk melihat log.</p>'
      return
    }
    list.innerHTML = '<p class="hint">Memuat log...</p>'
    try {
      var data = await Z.api('/bots/' + botId + '/errors', { timeoutMs: 10000 })
      var items = data.errors || []
      if (!items.length) {
        list.innerHTML = '<p class="hint">Belum ada error tercatat.</p>'
        return
      }
      list.innerHTML = items.map(function (e) {
        var t = e.createdAt ? new Date(e.createdAt).toLocaleString('id-ID') : ''
        return '<div class="err-item"><strong>.' + Z.escapeHtml(e.cmd || '?') + '</strong> · ' +
          Z.escapeHtml(t) + '<div class="err-msg">' + Z.escapeHtml(e.message || '') + '</div></div>'
      }).join('')
    } catch (e) {
      list.innerHTML = '<p class="error">' + Z.escapeHtml(e.message) + '</p>'
    }
  }

  async function loadSettings() {
    var botId = Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value
    var loading = Z.$('#settings-loading')
    var empty = Z.$('#settings-empty')
    var content = Z.$('#settings-content')
    if (!botId) {
      if (loading) loading.classList.add('hidden')
      if (content) content.classList.add('hidden')
      if (empty) empty.classList.remove('hidden')
      return
    }
    if (empty) empty.classList.add('hidden')
    if (loading) loading.classList.remove('hidden')
    if (content) content.classList.add('hidden')
    try {
      var data = await Z.api('/bots/' + botId + '/settings')
      var s = data.settings || {}
      if (Z.$('#set-mode')) Z.$('#set-mode').value = s.mode || 'public'
      if (Z.$('#set-enabled')) Z.$('#set-enabled').checked = data.enabled !== false
      if (Z.$('#set-autoread')) Z.$('#set-autoread').checked = !!s.autoread
      if (Z.$('#set-autotyping')) Z.$('#set-autotyping').checked = !!s.autotyping
      if (Z.$('#set-fastrespon')) Z.$('#set-fastrespon').checked = !!s.fastrespon
      if (Z.$('#set-noprefix')) Z.$('#set-noprefix').checked = !!s.noprefix
      if (Z.$('#set-gconly')) Z.$('#set-gconly').checked = !!(s.gconly === true || s.gconly === 'join' || s.gconly === 'closed')
      if (Z.$('#set-botname')) Z.$('#set-botname').value = data.botName || ''
      if (Z.$('#set-ownernumber')) Z.$('#set-ownernumber').value = data.ownerNumber || ''
      var id = data.identity || {}
      if (Z.$('#set-author')) Z.$('#set-author').value = id.author || ''
      if (Z.$('#set-packname')) Z.$('#set-packname').value = id.packname || ''
      if (Z.$('#set-title')) Z.$('#set-title').value = id.title || ''
      if (Z.$('#set-body')) Z.$('#set-body').value = id.body || ''
      if (Z.$('#set-thumbnail')) Z.$('#set-thumbnail').value = id.thumbnail || ''
      if (Z.$('#set-channelurl')) Z.$('#set-channelurl').value = id.channelUrl || ''
      if (Z.$('#set-idch')) Z.$('#set-idch').value = id.idch || ''
      if (Z.$('#set-groupurl')) Z.$('#set-groupurl').value = id.groupUrl || ''
      if (Z.$('#set-groupid')) Z.$('#set-groupid').value = id.groupId || ''
      var disabled = !data.isPremium
      ;['set-botname', 'set-ownernumber', 'set-author', 'set-packname', 'set-title', 'set-body',
        'set-thumbnail', 'set-channelurl', 'set-idch', 'set-groupurl', 'set-groupid'].forEach(function (i) {
        var el = Z.$('#' + i)
        if (el) el.disabled = disabled
      })
      if (Z.$('#premium-hint')) {
        Z.$('#premium-hint').textContent = data.isPremium
          ? 'Premium aktif — semua pengaturan tersedia.'
          : 'Fitur di bawah hanya Premium. Upgrade di Order Plan Premium.'
      }
    } catch (e) {
      if (Z.$('#settings-msg')) Z.$('#settings-msg').textContent = e.message
    } finally {
      if (loading) loading.classList.add('hidden')
      if (content) content.classList.remove('hidden')
    }
  }

  Z.bootPage(function () {
    Z.fillBotSelect('settings-bot-select')
    loadSettings()
    loadErrors()
    var sel = Z.$('#settings-bot-select')
    if (sel) sel.onchange = function () {
      loadSettings()
      loadErrors()
    }

    var rs = Z.$('#restart-bot-btn')
    if (rs) rs.onclick = function () {
      var botId = Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value
      doRestart(botId)
    }

    // Bot On/Off — langsung tanpa simpan full form
    var en = Z.$('#set-enabled')
    if (en) en.onchange = async function () {
      var botId = Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value
      if (!botId) return
      var msg = Z.$('#settings-msg')
      try {
        await Z.api('/bots/' + botId + '/power', {
          method: 'POST',
          body: { enabled: en.checked },
          timeoutMs: 30000
        })
        if (msg) {
          msg.textContent = en.checked ? 'Bot diaktifkan' : 'Bot dimatikan (session tetap tersimpan)'
          msg.className = 'msg ok'
        }
        Z.toast(en.checked ? 'Bot berhasil diaktifkan.' : 'Bot berhasil dimatikan.', 'success')
      } catch (e) {
        en.checked = !en.checked
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
        Z.toast(e.message, 'error')
      }
    }

    var save = Z.$('#save-settings-btn')
    if (save) save.onclick = async function () {
      var botId = Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value
      if (!botId) return
      if (Z.$('#settings-msg')) Z.$('#settings-msg').textContent = ''
      try {
        var gconlyOn = Z.$('#set-gconly') && Z.$('#set-gconly').checked
        await Z.api('/bots/' + botId + '/settings', {
          method: 'PUT',
          body: {
            mode: Z.$('#set-mode') && Z.$('#set-mode').value,
            autoread: Z.$('#set-autoread') && Z.$('#set-autoread').checked,
            autotyping: Z.$('#set-autotyping') && Z.$('#set-autotyping').checked,
            fastrespon: Z.$('#set-fastrespon') && Z.$('#set-fastrespon').checked,
            noprefix: Z.$('#set-noprefix') && Z.$('#set-noprefix').checked,
            gconly: gconlyOn ? 'join' : false,
            botName: Z.$('#set-botname') && Z.$('#set-botname').value,
            ownerNumber: Z.$('#set-ownernumber') && Z.$('#set-ownernumber').value,
            identity: {
              channelUrl: Z.$('#set-channelurl') && Z.$('#set-channelurl').value,
              groupUrl: Z.$('#set-groupurl') && Z.$('#set-groupurl').value,
              idch: Z.$('#set-idch') && Z.$('#set-idch').value,
              groupId: Z.$('#set-groupid') && Z.$('#set-groupid').value,
              author: Z.$('#set-author') && Z.$('#set-author').value,
              packname: Z.$('#set-packname') && Z.$('#set-packname').value,
              title: Z.$('#set-title') && Z.$('#set-title').value,
              body: Z.$('#set-body') && Z.$('#set-body').value,
              thumbnail: Z.$('#set-thumbnail') && Z.$('#set-thumbnail').value
            }
          }
        })
        try {
          await Z.restartBot(botId)
          if (Z.$('#settings-msg')) {
            Z.$('#settings-msg').textContent = 'Tersimpan & diterapkan'
            Z.$('#settings-msg').className = 'msg ok'
          }
          Z.toast('Bot Settings berhasil disimpan dan diterapkan.', 'success')
        } catch (re) {
          if (Z.$('#settings-msg')) {
            Z.$('#settings-msg').textContent = 'Tersimpan (restart: ' + re.message + ')'
            Z.$('#settings-msg').className = 'msg ok'
          }
          Z.toast('Bot Settings tersimpan, tetapi restart gagal: ' + re.message, 'warning')
        }
      } catch (e) {
        if (Z.$('#settings-msg')) {
          Z.$('#settings-msg').textContent = e.message
          Z.$('#settings-msg').className = 'msg err'
        }
        Z.toast('Gagal menyimpan Bot Settings: ' + e.message, 'error')
      }
    }
  })
})()
