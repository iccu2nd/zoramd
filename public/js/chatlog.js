(function () {
  'use strict'
  if (!window.Zora) return
  var Z = window.Zora
  var timer = null

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch { return '' }
  }

  function render(logs) {
    var wrap = document.getElementById('chatlog-list')
    if (!wrap) return
    if (!logs || !logs.length) {
      wrap.innerHTML = '<p class="hint">Belum ada pesan. Chat ke bot untuk melihat log.</p>'
      return
    }
    wrap.innerHTML = logs.map(function (l) {
      var where = l.isGroup
        ? ('GC · ' + (l.groupName || l.chatId || ''))
        : ('PC · ' + (l.chatId || ''))
      var text = l.text || (l.type ? '[' + l.type + ']' : '[media]')
      return '<div class="chatlog-item">' +
        '<div class="chatlog-top">' +
          '<strong>' + Z.escapeHtml(l.senderName || 'User') + '</strong>' +
          '<span class="chatlog-time">' + Z.escapeHtml(fmtTime(l.at)) + '</span>' +
        '</div>' +
        '<div class="chatlog-where">' + Z.escapeHtml(where) + '</div>' +
        '<div class="chatlog-text">' + Z.escapeHtml(text) + '</div>' +
        (l.pluginName ? '<div class="chatlog-plugin">' + Z.escapeHtml(l.pluginName) + '</div>' : '') +
      '</div>'
    }).join('')
  }

  async function loadLogs() {
    var botId = document.getElementById('chatlog-bot-select') && document.getElementById('chatlog-bot-select').value
    if (!botId) return
    try {
      var data = await Z.api('/bots/' + botId + '/chatlog', { timeoutMs: 8000 })
      render((data.logs || []).slice(0, 5))
    } catch (e) {
      var wrap = document.getElementById('chatlog-list')
      if (wrap) wrap.innerHTML = '<p class="error">' + Z.escapeHtml(e.message) + '</p>'
    }
  }

  function startLive() {
    if (timer) clearInterval(timer)
    loadLogs()
    // Refresh ringan tiap 4 detik — hanya halaman ini, dan hanya kalau tab aktif
    // (dulu ini jalan terus walau tab di-background, boros request ke server tanpa guna).
    timer = setInterval(function () {
      if (document.hidden) return
      loadLogs()
    }, 4000)
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && timer) loadLogs()
  })

  Z.bootPage(function () {
    Z.fillBotSelect('chatlog-bot-select')
    startLive()
    var sel = document.getElementById('chatlog-bot-select')
    if (sel) sel.onchange = startLive
    window.addEventListener('beforeunload', function () {
      if (timer) clearInterval(timer)
    })
  })
})()
