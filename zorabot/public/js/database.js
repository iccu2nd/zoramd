(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora

  Z.bootPage(function () {
    Z.fillBotSelect('db-bot-select')
    // show admin link
    if (Z.state.user && Z.state.user.isAdmin) {
      var n = document.getElementById('nav-admin')
      if (n) n.classList.remove('hidden')
    }

    var dl = document.getElementById('db-download-btn')
    if (dl) dl.onclick = async function () {
      var botId = document.getElementById('db-bot-select') && document.getElementById('db-bot-select').value
      if (!botId) return alert('Pilih bot dulu')
      var withSession = document.getElementById('db-include-session') && document.getElementById('db-include-session').checked
      var msg = document.getElementById('db-msg')
      try {
        var url = '/api/bots/' + botId + '/database' + (withSession ? '?session=1' : '')
        var res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + (Z.state.token || '') },
          credentials: 'include'
        })
        if (!res.ok) {
          var err = await res.json().catch(function () { return {} })
          throw new Error(err.error || res.statusText)
        }
        var data = await res.json()
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        var a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'database-' + (data.bot && data.bot.sessionId ? data.bot.sessionId : botId) + '.json'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(a.href)
        if (msg) { msg.textContent = 'Download dimulai.'; msg.className = 'msg ok' }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
        else alert(e.message)
      }
    }

    var imp = document.getElementById('db-import-btn')
    if (imp) imp.onclick = async function () {
      var botId = document.getElementById('db-bot-select') && document.getElementById('db-bot-select').value
      if (!botId) return alert('Pilih bot dulu')
      var fileInput = document.getElementById('db-file')
      if (!fileInput || !fileInput.files || !fileInput.files[0]) return alert('Pilih file JSON dulu')
      var msg = document.getElementById('db-msg')
      try {
        var text = await fileInput.files[0].text()
        var json = JSON.parse(text)
        var res = await Z.api('/bots/' + botId + '/database/import', {
          method: 'POST',
          body: json,
          timeoutMs: 30000
        })
        if (msg) {
          msg.textContent = 'Import OK. Users: ' + (res.imported && res.imported.users) +
            ', session keys: ' + (res.imported && res.imported.sessionKeys) +
            '. ' + (res.note || '')
          msg.className = 'msg ok'
        }
      } catch (e) {
        if (msg) { msg.textContent = e.message; msg.className = 'msg err' }
        else alert(e.message)
      }
    }
  })
})()
