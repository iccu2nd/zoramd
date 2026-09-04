export default {
    cmd: ['>', '=>', '$'],
    category: 'owner',
    description: 'Perintah developer dinonaktifkan demi keamanan',
    run: async (m, { isOwner }) => {
        if (!isOwner) return
        return m.reply('Perintah developer dinonaktifkan demi keamanan server.')
    }
}
