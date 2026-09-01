const { $, state, api, bootPage, fillBotSelect } = window.Zora

async function loadSettings() {
  const botId = $('#settings-bot-select')?.value
  if (!botId) return
  try {
    const data = await api(`/bots/${botId}/settings`)
    const s = data.settings || {}
    $('#set-mode').value = s.mode || 'public'
    $('#set-autoread').checked = !!s.autoread
    $('#set-autotyping').checked = !!s.autotyping
    $('#set-noprefix').checked = !!s.noprefix
    $('#set-botname').value = data.botName || ''
    $('#set-ownernumber').value = data.ownerNumber || ''
    const id = data.identity || {}
    $('#set-channelurl').value = id.channelUrl || ''
    $('#set-groupurl').value = id.groupUrl || ''
    const disabled = !data.isPremium
    ;['set-botname', 'set-ownernumber', 'set-channelurl', 'set-groupurl'].forEach(i => {
      $('#' + i).disabled = disabled
    })
    $('#premium-hint').textContent = data.isPremium
      ? 'Akun Premium aktif — semua pengaturan tersedia.'
      : 'Fitur di bawah hanya untuk Premium. Upgrade di menu Order Plan Premium.'
  } catch (e) {
    $('#settings-msg').textContent = e.message
  }
}

bootPage(() => {
  fillBotSelect('settings-bot-select')
  loadSettings()
  $('#settings-bot-select').onchange = loadSettings
  $('#save-settings-btn').onclick = async () => {
    const botId = $('#settings-bot-select')?.value
    if (!botId) return
    $('#settings-msg').textContent = ''
    try {
      await api(`/bots/${botId}/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          mode: $('#set-mode').value,
          autoread: $('#set-autoread').checked,
          autotyping: $('#set-autotyping').checked,
          noprefix: $('#set-noprefix').checked,
          botName: $('#set-botname').value,
          ownerNumber: $('#set-ownernumber').value,
          identity: {
            channelUrl: $('#set-channelurl').value,
            groupUrl: $('#set-groupurl').value
          }
        })
      })
      $('#settings-msg').textContent = 'Tersimpan'
      $('#settings-msg').className = 'msg ok'
    } catch (e) {
      $('#settings-msg').textContent = e.message
      $('#settings-msg').className = 'msg err'
    }
  }
})
