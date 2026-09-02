(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  async function doRestart(botId) {
    if (!botId) return alert('Pilih bot')
    try {
      await Z.restartBot(botId)
      alert('Bot di-restart')
    } catch (e) { alert(e.message) }
  }

  async function loadSettings() {
    var botId = Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value
    if (!botId) return
    var loading = Z.$('#settings-loading')
    var content = Z.$('#settings-content')
    if (loading) loading.classList.remove('hidden')
    if (content) content.classList.add('hidden')
    try {
      var data = await Z.api('/bots/' + botId + '/settings')
      var s = data.settings || {}
      if (Z.$('#set-mode')) Z.$('#set-mode').value = s.mode || 'public'
      if (Z.$('#set-enabled')) Z.$('#set-enabled').checked = data.enabled !== false
      if (Z.$('#set-autoread')) Z.$('#set-autoread').checked = !!s.autoread
      if (Z.$('#set-autotyping')) Z.$('#set-autotyping').checked = !!s.autotyping
      if (Z.$('#set-noprefix')) Z.$('#set-noprefix').checked = !!s.noprefix
      if (Z.$('#set-gconly')) Z.$('#set-gconly').checked = !!(s.gconly === true || s.gconly === 'join' || s.gconly === 'closed')
      if (Z.$('#set-botname')) Z.$('#set-botname').value = data.botName || ''
      if (Z.$('#set-ownernumber')) Z.$('#set-ownernumber').value = data.ownerNumber || ''
      var id = data.identity || {}
      if (Z.$('#set-channelurl')) Z.$('#set-channelurl').value = id.channelUrl || ''
      if (Z.$('#set-groupurl')) Z.$('#set-groupurl').value = id.groupUrl || ''
      var disabled = !data.isPremium
      ;['set-botname', 'set-ownernumber', 'set-channelurl', 'set-groupurl'].forEach(function (i) {
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
    var sel = Z.$('#settings-bot-select')
    if (sel) sel.onchange = loadSettings

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
      } catch (e) {
        en.checked = !en.checked
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
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
            noprefix: Z.$('#set-noprefix') && Z.$('#set-noprefix').checked,
            gconly: gconlyOn ? 'join' : false,
            botName: Z.$('#set-botname') && Z.$('#set-botname').value,
            ownerNumber: Z.$('#set-ownernumber') && Z.$('#set-ownernumber').value,
            identity: {
              channelUrl: Z.$('#set-channelurl') && Z.$('#set-channelurl').value,
              groupUrl: Z.$('#set-groupurl') && Z.$('#set-groupurl').value
            }
          }
        })
        try {
          await Z.restartBot(botId)
          if (Z.$('#settings-msg')) {
            Z.$('#settings-msg').textContent = 'Tersimpan & diterapkan'
            Z.$('#settings-msg').className = 'msg ok'
          }
        } catch (re) {
          if (Z.$('#settings-msg')) {
            Z.$('#settings-msg').textContent = 'Tersimpan (restart: ' + re.message + ')'
            Z.$('#settings-msg').className = 'msg ok'
          }
        }
      } catch (e) {
        if (Z.$('#settings-msg')) {
          Z.$('#settings-msg').textContent = e.message
          Z.$('#settings-msg').className = 'msg err'
        }
      }
    }
  })
})()
