(function () {
  if (!window.Zora) {
    document.getElementById('loading-text') && (document.getElementById('loading-text').textContent = 'Gagal memuat script. Refresh halaman.')
    return
  }
  const { $, escapeHtml, state, api, bootPage, loadBots } = window.Zora

  let limits = { max: 1, used: 0, plan: 'free' }

  function renderBots() {
    const list = $('#bots-list')
    if (!list) return
    const bar = $('#limits-bar')
    if (bar) {
      bar.innerHTML = `
        <span>Plan: <strong>${limits.plan === 'premium' ? 'Premium' : 'Free'}</strong></span>
        <span>Bot: <strong>${limits.used}</strong> / ${limits.max}</span>
        ${limits.plan !== 'premium' ? '<span style="color:#6b7280;font-size:0.85rem">Upgrade Premium → hingga 3 bot</span>' : ''}
      `
    }
    if (!state.bots || !state.bots.length) {
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
    if (state.limits) limits = state.limits
    else {
      try {
        const data = await api('/bots', { timeoutMs: 12000 })
        state.bots = data.bots || []
        limits = data.limits || limits
      } catch (e) {
        console.warn(e)
      }
    }
    renderBots()

    const btn = $('#create-bot-btn')
    if (!btn) return
    btn.onclick = async () => {
      if (limits.used >= limits.max) {
        alert(limits.plan === 'premium'
          ? 'Batas Premium: maksimal 3 bot.'
          : 'Batas Free: maksimal 1 bot. Upgrade Premium untuk hingga 3 bot.')
        return
      }
      const name = prompt('Nama bot:', 'ZoraBot')
      if (name === null) return
      try {
        const res = await api('/bots', {
          method: 'POST',
          body: JSON.stringify({ botName: name || 'ZoraBot' })
        })
        if (res.limits) limits = res.limits
        const data = await api('/bots')
        state.bots = data.bots || []
        limits = data.limits || limits
        renderBots()
      } catch (e) {
        alert(e.message)
      }
    }
  })
})()
