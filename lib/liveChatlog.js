/** Ring buffer chatlog in-memory — max 8 pesan terbaru per bot session */
const MAX = 8
const stores = new Map() // sessionId -> array

export function pushChatLog(sessionId, entry) {
    if (!sessionId) return
    let list = stores.get(sessionId)
    if (!list) {
        list = []
        stores.set(sessionId, list)
    }
    list.push({
        at: Date.now(),
        isGroup: !!entry.isGroup,
        groupName: entry.groupName || null,
        chatId: entry.chatId || null,
        senderName: entry.senderName || 'User',
        senderId: entry.senderId || null,
        type: entry.type || null,
        text: entry.text ? String(entry.text).slice(0, 300) : '',
        pluginName: entry.pluginName || null,
        isOutgoing: !!entry.isOutgoing
    })
    while (list.length > MAX) list.shift()
}

export function getChatLog(sessionId) {
    const list = stores.get(sessionId) || []
    // terbaru di atas
    return [...list].reverse()
}

export function clearChatLog(sessionId) {
    stores.delete(sessionId)
}
