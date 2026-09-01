const { $, escapeHtml, state, bootPage } = window.Zora

bootPage(() => {
  $('#account-info').innerHTML = `
    <p><strong>Email</strong><br/>${escapeHtml(state.user?.email || '-')}</p>
    <p style="margin-top:12px"><strong>Nama</strong><br/>${escapeHtml(state.user?.name || '-')}</p>
    <p style="margin-top:12px"><strong>User ID</strong><br/>${escapeHtml(state.user?.id || '-')}</p>
  `
})
