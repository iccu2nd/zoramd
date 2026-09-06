(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  function val(id) { var el = Z.$('#' + id); return el ? el.value : '' }
  function chk(id) { var el = Z.$('#' + id); return el ? !!el.checked : false }
  function setVal(id, v) { var el = Z.$('#' + id); if (el) el.value = v == null ? '' : v }
  function setChk(id, v) { var el = Z.$('#' + id); if (el) el.checked = !!v }

  async function doRestart(botId) {
    if (!botId) return Z.toast('Select a bot first.', 'warning')
    try {
      await Z.restartBot(botId)
      Z.toast('Bot berhasil di-restart.', 'success')
    } catch (e) { Z.toast(e.message, 'error') }
  }

  async function loadErrors() {
    var botId = Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value
    var list = Z.$('#settings-err-list')
    if (!list) return
    if (!botId) { list.innerHTML = '<p class="hint">Pilih bot untuk melihat log.</p>'; return }
    list.innerHTML = '<p class="hint">Loading logs...</p>'
    try {
      var data = await Z.api('/bots/' + botId + '/errors', { timeoutMs: 10000 })
      var items = data.errors || []
      if (!items.length) { list.innerHTML = '<p class="hint">Belum ada error tercatat.</p>'; return }
      list.innerHTML = items.map(function (e) {
        var t = e.createdAt ? new Date(e.createdAt).toLocaleString('id-ID') : ''
        return '<div class="err-item"><strong>.' + Z.escapeHtml(e.cmd || '?') + '</strong> · ' +
          Z.escapeHtml(t) + '<div class="err-msg">' + Z.escapeHtml(e.message || '') + '</div></div>'
      }).join('')
    } catch (e) {
      list.innerHTML = '<p class="error">' + Z.escapeHtml(e.message) + '</p>'
    }
  }

  function bindTabs() {
    var tabs = document.querySelectorAll('#settings-tabs .tab-btn')
    tabs.forEach(function (btn) {
      btn.onclick = function () {
        tabs.forEach(function (b) { b.classList.remove('active') })
        btn.classList.add('active')
        var tab = btn.getAttribute('data-tab')
        document.querySelectorAll('.tab-panel').forEach(function (p) {
          if (p.getAttribute('data-panel') === tab) p.classList.remove('hidden')
          else p.classList.add('hidden')
        })
      }
    })
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
      var msg = s.messages || {}
      var plan = data.plan || (data.isPremium ? 'pro' : 'free')

      if (Z.$('#plan-badge')) {
        Z.$('#plan-badge').textContent = 'Plan: ' + String(plan).toUpperCase() +
          (data.isPremium ? ' (aktif)' : ' — upgrade untuk full control')
      }

      // General
      setChk('set-enabled', s.enabled !== false)
      setChk('set-autoread', s.autoread)
      setChk('set-autotyping', s.autotyping)
      setChk('set-autorecording', s.autorecording)
      setChk('set-fastrespon', s.fastrespon)
      setChk('set-noprefix', s.noprefix)
      setChk('set-gconly', !!s.gconly)
      setChk('set-maintenance', s.maintenance)
      setVal('set-mode', s.mode || 'public')
      setVal('set-prefixes', Array.isArray(s.prefixes) ? s.prefixes.join(' ') : (s.prefixes || '. / # !'))
      setVal('set-language', s.language || 'id')
      setVal('set-timezone', s.timezone || 'Asia/Jakarta')
      setVal('set-footer', s.footer || '')
      setVal('set-responsedelay', s.responseDelayMs || 0)
      setVal('set-maintenancemsg', s.maintenanceMessage || '')

      // Verification
      setChk('set-verif-enabled', s.verificationEnabled !== false)
      setChk('set-verif-owner', s.verificationBypassOwner !== false)
      setChk('set-verif-admin', s.verificationBypassAdmin)
      setChk('set-verif-prem', s.verificationBypassPremium)
      setVal('set-verif-msg', s.verificationMessage || '')

      // Limit
      setChk('set-limit-enabled', s.limitEnabled)
      setVal('set-limit-free', s.limitFree != null ? s.limitFree : 15)
      setVal('set-limit-prem', s.limitPremium != null ? s.limitPremium : 100)
      setVal('set-limit-admin', s.limitAdmin != null ? s.limitAdmin : 200)
      setVal('set-limit-owner', s.limitOwner != null ? s.limitOwner : -1)
      setVal('set-limit-reset', s.limitResetHour != null ? s.limitResetHour : 0)
      setVal('set-limit-msg', s.limitMessage || '')

      // Messages
      setVal('msg-error', msg.error || 'Maaf fitur sedang error.')
      setVal('msg-loading', msg.loading || '')
      setVal('msg-success', msg.success || '')
      setVal('msg-failed', msg.failed || '')
      setVal('msg-premium', msg.premiumRequired || '')
      setVal('msg-verifreq', msg.verificationRequired || '')
      setVal('msg-limithabis', msg.limitHabis || '')
      setVal('msg-owneronly', msg.ownerOnly || '')
      setVal('msg-adminonly', msg.adminOnly || '')
      setVal('msg-banned', msg.banned || '')
      setVal('msg-maintenance', msg.maintenance || '')
      setVal('msg-unknown', msg.unknownCommand || '')
      setVal('msg-welcome', msg.welcome || '')
      setVal('msg-goodbye', msg.goodbye || '')
      setChk('set-showtech', s.showTechnicalError)
      setChk('set-errorreport', s.errorReport !== false)

      // Identity
      setVal('set-botname', data.botName || '')
      setVal('set-ownernumber', data.ownerNumber || '')
      var id = data.identity || {}
      setVal('set-author', id.author || '')
      setVal('set-packname', id.packname || '')
      setVal('set-title', id.title || '')
      setVal('set-body', id.body || '')
      setVal('set-thumbnail', id.thumbnail || '')
      setVal('set-channelurl', id.channelUrl || '')
      setVal('set-idch', id.idch || '')
      setVal('set-groupurl', id.groupUrl || '')
      setVal('set-groupid', id.groupId || '')
      setVal('set-sourceurl', id.sourceUrl || '')

      // Advanced
      setVal('set-extraowners', (s.extraOwners || []).map(function (j) { return String(j).split('@')[0] }).join(', '))
      setVal('set-blockedcmds', (s.blockedCmds || []).join(', '))
      setChk('set-gconly-prem', s.gconlyPremiumBypass)

      if (Z.$('#premium-hint')) {
        Z.$('#premium-hint').textContent = data.isPremium
          ? 'Plan ' + plan + ' aktif — identity & advanced tersedia.'
          : 'Identity & advanced butuh paket Basic ke atas.'
      }
    } catch (e) {
      if (Z.$('#settings-msg')) Z.$('#settings-msg').textContent = e.message
    } finally {
      if (loading) loading.classList.add('hidden')
      if (content) content.classList.remove('hidden')
    }
  }

  function collectPayload() {
    return {
      enabled: chk('set-enabled'),
      mode: val('set-mode') || 'public',
      autoread: chk('set-autoread'),
      autotyping: chk('set-autotyping'),
      autorecording: chk('set-autorecording'),
      fastrespon: chk('set-fastrespon'),
      noprefix: chk('set-noprefix'),
      gconly: chk('set-gconly') ? true : false,
      gconlyPremiumBypass: chk('set-gconly-prem'),
      maintenance: chk('set-maintenance'),
      maintenanceMessage: val('set-maintenancemsg'),
      prefixes: val('set-prefixes'),
      language: val('set-language'),
      timezone: val('set-timezone'),
      footer: val('set-footer'),
      responseDelayMs: Number(val('set-responsedelay')) || 0,
      verificationEnabled: chk('set-verif-enabled'),
      verificationMessage: val('set-verif-msg'),
      verificationBypassOwner: chk('set-verif-owner'),
      verificationBypassAdmin: chk('set-verif-admin'),
      verificationBypassPremium: chk('set-verif-prem'),
      limitEnabled: chk('set-limit-enabled'),
      limitFree: Number(val('set-limit-free')),
      limitPremium: Number(val('set-limit-prem')),
      limitAdmin: Number(val('set-limit-admin')),
      limitOwner: Number(val('set-limit-owner')),
      limitResetHour: Number(val('set-limit-reset')),
      limitMessage: val('set-limit-msg'),
      showTechnicalError: chk('set-showtech'),
      errorReport: chk('set-errorreport'),
      messages: {
        error: val('msg-error'),
        loading: val('msg-loading'),
        success: val('msg-success'),
        failed: val('msg-failed'),
        premiumRequired: val('msg-premium'),
        verificationRequired: val('msg-verifreq'),
        limitHabis: val('msg-limithabis'),
        ownerOnly: val('msg-owneronly'),
        adminOnly: val('msg-adminonly'),
        banned: val('msg-banned'),
        maintenance: val('msg-maintenance'),
        unknownCommand: val('msg-unknown'),
        welcome: val('msg-welcome'),
        goodbye: val('msg-goodbye')
      },
      botName: val('set-botname'),
      ownerNumber: val('set-ownernumber'),
      identity: {
        botName: val('set-botname'),
        ownerNumber: val('set-ownernumber'),
        author: val('set-author'),
        packname: val('set-packname'),
        title: val('set-title'),
        body: val('set-body'),
        thumbnail: val('set-thumbnail'),
        channelUrl: val('set-channelurl'),
        idch: val('set-idch'),
        groupUrl: val('set-groupurl'),
        groupId: val('set-groupid'),
        sourceUrl: val('set-sourceurl')
      },
      extraOwners: val('set-extraowners'),
      blockedCmds: val('set-blockedcmds')
    }
  }

  Z.bootPage(function () {
    Z.fillBotSelect('settings-bot-select')
    bindTabs()
    loadSettings()
    loadErrors()
    var sel = Z.$('#settings-bot-select')
    if (sel) sel.onchange = function () { loadSettings(); loadErrors() }

    var rs = Z.$('#restart-bot-btn')
    if (rs) rs.onclick = function () {
      doRestart(Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value)
    }

    var save = Z.$('#save-settings-btn')
    if (save) save.onclick = async function () {
      var botId = Z.$('#settings-bot-select') && Z.$('#settings-bot-select').value
      if (!botId) return Z.toast('Pilih bot dulu', 'warning')
      var msg = Z.$('#settings-msg')
      if (msg) { msg.textContent = 'Menyimpan...'; msg.className = 'msg' }
      try {
        var body = collectPayload()
        var res = await Z.api('/bots/' + botId + '/settings', {
          method: 'PUT',
          body: body,
          timeoutMs: 15000
        })
        if (msg) { msg.textContent = 'Tersimpan. Perubahan langsung aktif tanpa restart.'; msg.className = 'msg ok' }
        Z.toast('Settings disimpan', 'success')
        if (res && res.plan && Z.$('#plan-badge')) {
          Z.$('#plan-badge').textContent = 'Plan: ' + String(res.plan).toUpperCase()
        }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg error' }
        Z.toast(e.message, 'error')
      }
    }
  })
})()
