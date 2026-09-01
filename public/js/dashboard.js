const { $, escapeHtml, state, api, bootPage, loadBots } = window.Zora

let limits = { max: 1, used: 0, plan: 'free' }

function renderBots() {
  const list = $('#bots-list')
  const bar = $('#limits-bar')
  if (bar) {
    bar.innerHTML = `
      <span>Plan: <strong>${limits.plan === 'premium' ? 'Premium' : 'Free'}</strong></span>
      <span>Bot: <strong>${limits.used}</strong> / ${limits.max}</span>
      ${limits.plan !== 'premium' ? '<span class="hint" style="margin:0">Upgrade Premium → hingga 3 bot</span>' : ''}
    `
  }
  if (!state.bots.length) {
    list.innerHTML = '<p class="hint">Belum ada bot. Buat bot baru untuk memulai.</p>'
    return
  }
  list.innerHTML = state.bots.map(b => `
    <div class="bot-card">
      <div>
        <h3>${escapeHtml(b.botName)}</h3>
        <div class="bot-meta">${escapeHtml(b.sessionId)}</div>
      </div>
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="badge ${escapeHtml(b.status)}">${escapeHtml(b.status)}</span>
        ${b.plan === 'premium' ? '<span class="badge premium">Premium</span>' : '<span class="badge">Free</span>'}
      </div>
    </div>
  `).join('')
}

bootPage(async () => {
  // loadBots already called in bootPage; refresh with limits
  try {
    const data = await api('/bots')
    state.bots = data.bots || []
    limits = data.limits || limits
  } catch {}
  renderBots()

  $('#create-bot-btn').onclick = async () => {
    if (limits.used >= limits.max) {
      alert(limits.plan === 'premium'
        ? 'Batas Premium: maksimal 3 bot.'
        : 'Batas Free: maksimal 1 bot. Upgrade Premium untuk hingga 3 bot.')
      return
    }
    const name = prompt('Nama bot:', 'ZoraBot')
    if (name === null) return
    try {
      const res = await api('/bots', { method: 'POST', body: JSON.stringify({ botName: name || 'ZoraBot' }) })
      if (res.limits) limits = res.limits
      await loadBots()
      try {
        const data = await api('/bots')
        state.bots = data.bots || []
        limits = data.limits || limits
      } catch {}
      renderBots()
    } catch (e) {
      alert(e.message)
    }
  }
})
