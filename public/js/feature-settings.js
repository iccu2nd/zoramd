const { $, escapeHtml, api, bootPage, fillBotSelect } = window.Zora

const CAT_LABEL = {
  main: 'Main',
  tools: 'Tools',
  group: 'Group',
  downloader: 'Downloader',
  games: 'Games',
  game: 'Games',
  fun: 'Fun',
  info: 'Info',
  owner: 'Owner',
  rpg: 'RPG',
  owo: 'OwO',
  social: 'Social',
  maker: 'Maker',
  image: 'Image',
  nsfw: 'NSFW',
  donasi: 'Donasi',
  others: 'Lainnya'
}

function catLabel(c) {
  return CAT_LABEL[c] || (c.charAt(0).toUpperCase() + c.slice(1))
}

async function loadFeatures() {
  const botId = $('#feature-bot-select')?.value
  if (!botId) return
  const wrap = $('#features-list')
  wrap.innerHTML = '<p class="hint">Memuat semua fitur...</p>'
  try {
    const data = await api(`/bots/${botId}/features`)
    const groups = data.groups || {}
    const cats = data.categories || Object.keys(groups)
    if (!cats.length) {
      wrap.innerHTML = '<p class="hint">Belum ada plugin ter-load.</p>'
      return
    }

    wrap.innerHTML = cats.map(cat => {
      const items = groups[cat] || []
      const onCount = items.filter(f => f.enabled !== false).length
      return `
        <div class="feat-group" data-cat="${escapeHtml(cat)}">
          <button type="button" class="feat-group-head">
            <span class="feat-group-title">${escapeHtml(catLabel(cat))}</span>
            <span class="feat-group-meta">${onCount}/${items.length} aktif</span>
            <span class="feat-group-chevron">▸</span>
          </button>
          <div class="feat-group-body">
            ${items.map(f => featureRow(f, data.isPremium)).join('')}
          </div>
        </div>`
    }).join('')

    wrap.querySelectorAll('.feat-group').forEach(g => {
      g.querySelector('.feat-group-head').onclick = () => g.classList.toggle('open')
    })

    wrap.querySelectorAll('.feature-item').forEach(item => {
      item.querySelector('.feat-enabled').onchange = async (e) => {
        try {
          await api(`/bots/${botId}/features/${item.dataset.key}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled: e.target.checked })
          })
          // update count badge
          const group = item.closest('.feat-group')
          const on = group.querySelectorAll('.feat-enabled:checked').length
          const total = group.querySelectorAll('.feat-enabled').length
          group.querySelector('.feat-group-meta').textContent = `${on}/${total} aktif`
        } catch (err) { alert(err.message) }
      }
      item.querySelector('.feat-save')?.addEventListener('click', async () => {
        try {
          await api(`/bots/${botId}/features/${item.dataset.key}`, {
            method: 'PUT',
            body: JSON.stringify({
              enabled: item.querySelector('.feat-enabled').checked,
              accessRule: item.querySelector('.feat-access')?.value || 'public',
              customResponse: item.querySelector('.feat-response')?.value || null,
              customCommand: item.querySelector('.feat-command')?.value || null
            })
          })
          const msg = item.querySelector('.feat-saved')
          if (msg) { msg.textContent = 'Tersimpan'; setTimeout(() => msg.textContent = '', 1500) }
        } catch (err) { alert(err.message) }
      })
    })
  } catch (e) {
    wrap.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`
  }
}

function featureRow(f, isPremium) {
  const key = f.featureKey
  return `
    <div class="feature-item" data-key="${escapeHtml(key)}">
      <div class="feature-row">
        <div class="feature-info">
          <span class="name">${escapeHtml(key)}</span>
          ${f.description ? `<span class="desc">${escapeHtml(String(f.description).slice(0, 80))}</span>` : ''}
        </div>
        <label class="switch-label"><input type="checkbox" class="feat-enabled" ${f.enabled !== false ? 'checked' : ''}/> ON</label>
      </div>
      <div class="feature-detail">
        <div class="field">
          <label>Access Rule</label>
          <select class="feat-access" ${isPremium ? '' : 'disabled'}>
            ${[['owner','Owner Only'],['group','Group Only'],['owner_group','Owner + Group'],['public','Public']].map(([v,l]) =>
              `<option value="${v}" ${f.accessRule === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label>Custom Response</label>
          <input class="feat-response" type="text" value="${escapeHtml(f.customResponse || '')}" ${isPremium ? '' : 'disabled'} placeholder="Kosongkan = default" />
        </div>
        <div class="field">
          <label>Custom Command</label>
          <input class="feat-command" type="text" value="${escapeHtml(f.customCommand || '')}" ${isPremium ? '' : 'disabled'} placeholder="Kosongkan = default" />
        </div>
        <div class="row gap">
          <button type="button" class="btn outline feat-save">Simpan</button>
          <span class="feat-saved msg ok"></span>
        </div>
      </div>
    </div>`
}

bootPage(() => {
  fillBotSelect('feature-bot-select')
  loadFeatures()
  $('#feature-bot-select').onchange = loadFeatures
})
