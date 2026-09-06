/**
 * Lightweight concurrency control with Premium + light-command priority.
 * - Per-chat lanes so one chat never blocks another.
 * - Premium waiters preferred over free.
 * - Light commands (tools/info/main/group/fun/owner) preferred over heavy
 *   when competing in the same lane (keeps .ping / menu / admin commands snappy).
 * - Category-based timeouts so heavy download/media/RPG do not get false "timed out".
 *
 * Env:
 *   CMD_CONCURRENCY_FREE (default 6)
 *   CMD_CONCURRENCY_PREMIUM (default 16)
 *   CMD_TIMEOUT_MS (default 30000 light)
 *   CMD_TIMEOUT_MEDIUM_MS (default 60000)
 *   CMD_TIMEOUT_HEAVY_MS (default 120000)
 *   CMD_WAIT_FREE / CMD_WAIT_PREMIUM
 */
const lanes = new Map()

const DEFAULT_CONCURRENCY = {
    free: Number(process.env.CMD_CONCURRENCY_FREE || 6),
    premium: Number(process.env.CMD_CONCURRENCY_PREMIUM || 16)
}

const DEFAULT_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MS || 30_000)
const MEDIUM_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MEDIUM_MS || 60_000)
const HEAVY_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_HEAVY_MS || 120_000)

const LIGHT_CATEGORIES = new Set([
    'tools', 'info', 'main', 'group', 'fun', 'owner', 'social', undefined, null, ''
])

const CATEGORY_TIMEOUT_MS = {
    downloader: HEAVY_TIMEOUT_MS,
    maker: HEAVY_TIMEOUT_MS,
    image: HEAVY_TIMEOUT_MS,
    nsfw: HEAVY_TIMEOUT_MS,
    donasi: HEAVY_TIMEOUT_MS,
    rpg: MEDIUM_TIMEOUT_MS,
    owo: MEDIUM_TIMEOUT_MS,
    games: MEDIUM_TIMEOUT_MS,
    game: MEDIUM_TIMEOUT_MS
}

const MAX_WAIT = {
    free: Number(process.env.CMD_WAIT_FREE || 40),
    premium: Number(process.env.CMD_WAIT_PREMIUM || 80)
}

function resolveTimeoutMs(category, overrideMs) {
    if (Number.isFinite(overrideMs) && overrideMs > 0) return overrideMs
    if (category && CATEGORY_TIMEOUT_MS[category]) return CATEGORY_TIMEOUT_MS[category]
    return DEFAULT_TIMEOUT_MS
}

function isLightCategory(category) {
    return LIGHT_CATEGORIES.has(category) || !CATEGORY_TIMEOUT_MS[category]
}

function withTimeout(task, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error('Command timed out'))
        }, timeoutMs)

        Promise.resolve()
            .then(() => task())
            .then((value) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                resolve(value)
            }, (error) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                reject(error)
            })
    })
}

/**
 * Priority order when picking next job in a lane:
 * 1. Premium + light
 * 2. Premium (any)
 * 3. Free + light
 * 4. Free (FIFO)
 */
function takeNext(lane) {
    // Prefer Premium light
    let idx = lane.wait.findIndex((j) => j.isPremium && j.isLight)
    if (idx >= 0) return lane.wait.splice(idx, 1)[0]
    // Prefer any Premium
    idx = lane.wait.findIndex((j) => j.isPremium)
    if (idx >= 0) return lane.wait.splice(idx, 1)[0]
    // Prefer free light
    idx = lane.wait.findIndex((j) => j.isLight)
    if (idx >= 0) return lane.wait.splice(idx, 1)[0]
    return lane.wait.shift()
}

function pump(lane) {
    while (lane.running < lane.maxConcurrent && lane.wait.length) {
        const job = takeNext(lane)
        if (!job) break
        lane.running++
        Promise.resolve()
            .then(() => withTimeout(job.task, job.timeoutMs))
            .then(job.resolve, job.reject)
            .finally(() => {
                lane.running--
                if (lane.wait.length) pump(lane)
                else if (lane.running === 0) {
                    for (const [k, v] of lanes) {
                        if (v === lane) {
                            lanes.delete(k)
                            break
                        }
                    }
                }
            })
    }
}

/**
 * @param {boolean} isPremium
 * @param {() => Promise<any>} task
 * @param {{ key?: string, category?: string, timeoutMs?: number }} options
 */
export function runWithFreeQueue(isPremium, task, options = {}) {
    const key = String(options.key || 'default')
    const max = isPremium ? DEFAULT_CONCURRENCY.premium : DEFAULT_CONCURRENCY.free
    let lane = lanes.get(key)
    if (!lane) {
        lane = { running: 0, wait: [], maxConcurrent: max }
        lanes.set(key, lane)
    }
    if (isPremium && lane.maxConcurrent < DEFAULT_CONCURRENCY.premium) {
        lane.maxConcurrent = DEFAULT_CONCURRENCY.premium
    }

    const timeoutMs = resolveTimeoutMs(options.category, options.timeoutMs)
    const isLight = isLightCategory(options.category)

    return new Promise((resolve, reject) => {
        const waitCap = isPremium ? MAX_WAIT.premium : MAX_WAIT.free
        if (lane.running >= lane.maxConcurrent && lane.wait.length >= waitCap) {
            reject(new Error('Too many concurrent commands. Please try again shortly.'))
            return
        }
        lane.wait.push({
            task,
            resolve,
            reject,
            isPremium: !!isPremium,
            isLight,
            timeoutMs
        })
        pump(lane)
    })
}

export function freeQueueLength() {
    let n = 0
    for (const lane of lanes.values()) n += lane.wait.length
    return n
}

export function freeQueueStats() {
    let waiting = 0
    let running = 0
    for (const lane of lanes.values()) {
        waiting += lane.wait.length
        running += lane.running
    }
    return { waiting, running, lanes: lanes.size }
}
