/**
 * Resolve identity/settings bot yang sedang aktif.
 * Prioritas: sock.botConfig (live, dari Bot Settings) > config fallback > default.
 */
import configBase from '../config.js'

const DEFAULTS = {
    botName: 'ZoraBot',
    author: 'ZoraBot',
    packname: 'ZoraBot',
    title: '© ZoraBot',
    body: 'powered by ZoraBot',
    thumbnail: configBase.thumbnail || '',
    ownerNumber: configBase.ownerNumber || [],
    groupUrl: configBase.groupUrl || '',
    channelUrl: configBase.channelUrl || '',
    groupId: configBase.groupId || '',
    idch: configBase.idch || '',
    sourceUrl: configBase.sourceUrl || ''
}

/**
 * @param {object|null} sock
 * @param {object} [fallback] config yang di-pass handler (opsional)
 */
export function resolveBotConfig(sock, fallback = {}) {
    const live = (sock && sock.botConfig) ? sock.botConfig : {}
    const merged = {
        ...DEFAULTS,
        ...configBase,
        ...fallback,
        ...live
    }

    // Normalisasi field penting
    if (!merged.botName) merged.botName = DEFAULTS.botName
    if (!merged.packname) merged.packname = merged.botName || DEFAULTS.packname
    if (!merged.author) merged.author = merged.botName || DEFAULTS.author
    if (!merged.title) merged.title = DEFAULTS.title
    if (!merged.body) merged.body = DEFAULTS.body

    // ownerNumber selalu array digit-string
    let owners = merged.ownerNumber
    if (!Array.isArray(owners)) {
        owners = owners ? [owners] : []
    }
    merged.ownerNumber = owners
        .map(n => String(n).replace(/[^0-9]/g, ''))
        .filter(Boolean)

    if (sock?.sessionId) merged.botId = merged.botId || sock.sessionId
    return merged
}

/** Options sticker dari identity bot */
export function stickerIdentity(sock, fallback = {}) {
    const c = resolveBotConfig(sock, fallback)
    return {
        packname: c.packname || c.botName || 'ZoraBot',
        author: c.author || c.botName || 'ZoraBot'
    }
}
