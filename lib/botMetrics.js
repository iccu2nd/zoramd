/**
 * Lightweight in-memory bot metrics.
 * No heavy DB writes on every message — periodic snapshot optional.
 */
const bySession = new Map()
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function bucket() {
    return {
        startedAt: Date.now(),
        messagesIn: 0,
        messagesOut: 0,
        commands: 0,
        commandsOk: 0,
        commandsFail: 0,
        activeUsers: new Map(), // jid -> lastSeen
        hourly: [], // { t, in, out, cmds }
        lastResponseMs: 0,
        responseSamples: [],
        errors: 0
    }
}

function get(sessionId) {
    if (!sessionId) sessionId = 'default'
    let s = bySession.get(sessionId)
    if (!s) {
        s = bucket()
        bySession.set(sessionId, s)
    }
    return s
}

function pruneUsers(s) {
    const cutoff = Date.now() - DAY_MS
    for (const [k, t] of s.activeUsers) {
        if (t < cutoff) s.activeUsers.delete(k)
    }
    if (s.activeUsers.size > 5000) {
        const arr = [...s.activeUsers.entries()].sort((a, b) => a[1] - b[1])
        for (let i = 0; i < arr.length - 2000; i++) s.activeUsers.delete(arr[i][0])
    }
}

function pushHourly(s, field) {
    const hour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS
    let last = s.hourly[s.hourly.length - 1]
    if (!last || last.t !== hour) {
        last = { t: hour, in: 0, out: 0, cmds: 0, fail: 0 }
        s.hourly.push(last)
        while (s.hourly.length > 48) s.hourly.shift()
    }
    last[field] = (last[field] || 0) + 1
}

export function trackMessageIn(sessionId, senderJid) {
    const s = get(sessionId)
    s.messagesIn++
    pushHourly(s, 'in')
    if (senderJid) {
        s.activeUsers.set(String(senderJid), Date.now())
        if (s.activeUsers.size % 50 === 0) pruneUsers(s)
    }
}

export function trackMessageOut(sessionId) {
    const s = get(sessionId)
    s.messagesOut++
    pushHourly(s, 'out')
}

export function trackCommand(sessionId, ok, durationMs) {
    const s = get(sessionId)
    s.commands++
    pushHourly(s, 'cmds')
    if (ok) s.commandsOk++
    else {
        s.commandsFail++
        s.errors++
        pushHourly(s, 'fail')
    }
    if (typeof durationMs === 'number' && durationMs >= 0) {
        s.lastResponseMs = durationMs
        s.responseSamples.push(durationMs)
        if (s.responseSamples.length > 100) s.responseSamples.shift()
    }
}

export function getSessionMetrics(sessionId) {
    const s = get(sessionId)
    pruneUsers(s)
    const samples = s.responseSamples
    const avgResponseMs = samples.length
        ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
        : 0
    const active24h = s.activeUsers.size
    const errorRate = s.commands ? Math.round((s.commandsFail / s.commands) * 1000) / 10 : 0
    return {
        uptimeMs: Date.now() - s.startedAt,
        messagesIn: s.messagesIn,
        messagesOut: s.messagesOut,
        commands: s.commands,
        commandsOk: s.commandsOk,
        commandsFail: s.commandsFail,
        activeUsers24h: active24h,
        avgResponseMs,
        lastResponseMs: s.lastResponseMs,
        errorRate,
        hourly: s.hourly.slice(-24)
    }
}

export function getAggregateMetrics(sessionIds) {
    const ids = sessionIds && sessionIds.length ? sessionIds : [...bySession.keys()]
    const agg = {
        messagesIn: 0,
        messagesOut: 0,
        commands: 0,
        commandsOk: 0,
        commandsFail: 0,
        activeUsers24h: 0,
        avgResponseMs: 0,
        errorRate: 0,
        sessions: {}
    }
    let respSum = 0
    let respN = 0
    for (const id of ids) {
        const m = getSessionMetrics(id)
        agg.sessions[id] = m
        agg.messagesIn += m.messagesIn
        agg.messagesOut += m.messagesOut
        agg.commands += m.commands
        agg.commandsOk += m.commandsOk
        agg.commandsFail += m.commandsFail
        agg.activeUsers24h += m.activeUsers24h
        if (m.avgResponseMs) {
            respSum += m.avgResponseMs
            respN++
        }
    }
    agg.avgResponseMs = respN ? Math.round(respSum / respN) : 0
    agg.errorRate = agg.commands ? Math.round((agg.commandsFail / agg.commands) * 1000) / 10 : 0
    return agg
}
