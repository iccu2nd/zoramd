/**
 * Lightweight concurrency control with Premium priority.
 * - No serial free-user queue that stalls Premium.
 * - Per-chat lanes; when busy, Premium waiters are started first.
 * - Env: CMD_CONCURRENCY_FREE, CMD_CONCURRENCY_PREMIUM, CMD_TIMEOUT_MS,
 *   CMD_TIMEOUT_LONG_MS, CMD_TIMEOUT_MAX_MS
 *
 * Root cause of "Command timed out": every command used ONE global timeout
 * (45s) regardless of what it actually does. A plugin that legitimately
 * takes longer than that (downloading/converting media, calling a slow
 * external API, etc.) was killed at 45s even though it was still making
 * progress -- that's a false timeout, not a stuck command.
 *
 * Fix: the timeout budget is resolved per job instead of being a single
 * constant:
 *   1. `options.timeoutMs` on the call site wins if given (per-plugin override).
 *   2. Otherwise a per-category default is used (`downloader`/`converter`/
 *      `ai`/`tools` style commands get a longer budget than quick ones).
 *   3. Whatever is resolved is clamped to CMD_TIMEOUT_MAX_MS so a truly
 *      stuck command (infinite loop, hung socket, etc.) is still always
 *      caught by a safety timeout -- long-running is allowed, hanging forever
 *      is not.
 */
const lanes = new Map()

const DEFAULT_CONCURRENCY = {
    free: Number(process.env.CMD_CONCURRENCY_FREE || 3),
    premium: Number(process.env.CMD_CONCURRENCY_PREMIUM || 12)
}

// Default budget for commands with no more specific category/override.
const JOB_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MS || 45_000)
// Budget for categories known to legitimately run long (downloads, media
// conversion, AI calls, etc.) -- see CATEGORY_TIMEOUT_MS below.
const LONG_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_LONG_MS || 180_000)
// Hard safety ceiling: no command, however long-running, waits longer than
// this before being treated as stuck. Protects the queue even if a plugin
// misconfigures its own `timeout` far too high.
const MAX_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MAX_MS || 300_000)
const MIN_TIMEOUT_MS = 5_000

// Plugin categories that routinely need more than the default budget.
const CATEGORY_TIMEOUT_MS = {
    downloader: LONG_TIMEOUT_MS,
    converter: LONG_TIMEOUT_MS,
    media: LONG_TIMEOUT_MS,
    maker: LONG_TIMEOUT_MS,
    image: LONG_TIMEOUT_MS,
    ai: LONG_TIMEOUT_MS,
    tools: LONG_TIMEOUT_MS
}

const MAX_WAIT = {
    free: Number(process.env.CMD_WAIT_FREE || 25),
    premium: Number(process.env.CMD_WAIT_PREMIUM || 60)
}

function clampTimeout(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return JOB_TIMEOUT_MS
    return Math.min(Math.max(ms, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}

function resolveTimeoutMs(options) {
    if (options.timeoutMs) return clampTimeout(Number(options.timeoutMs))
    if (options.category && CATEGORY_TIMEOUT_MS[options.category]) {
        return clampTimeout(CATEGORY_TIMEOUT_MS[options.category])
    }
    return clampTimeout(JOB_TIMEOUT_MS)
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
            .then(task)
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

function takeNext(lane) {
    // Prefer Premium jobs waiting in this lane
    const idx = lane.wait.findIndex((j) => j.isPremium)
    if (idx >= 0) return lane.wait.splice(idx, 1)[0]
    return lane.wait.shift()
}

function pump(lane) {
    while (lane.running < lane.maxConcurrent && lane.wait.length) {
        const job = takeNext(lane)
        if (!job) break
        lane.running++
        // finally() ALWAYS runs here regardless of success, plugin error, or
        // timeout, so a slot is always freed and the lane is always cleaned
        // up -- one slow/stuck job can never leave the lane permanently
        // "running" and blocking the other job slots in the same lane.
        Promise.resolve()
            .then(() => withTimeout(job.task, job.timeoutMs))
            .then(job.resolve, job.reject)
            .finally(() => {
                lane.running--
                if (lane.wait.length) pump(lane)
                else if (lane.running === 0) {
                    // drop idle lane to avoid Map growth
                    for (const [k, v] of lanes) {
                        if (v === lane) lanes.delete(k)
                    }
                }
            })
    }
}

/**
 * @param {boolean} isPremium
 * @param {() => Promise<any>} task
 * @param {{ key?: string, category?: string, timeoutMs?: number }} options
 *   `key` scopes concurrency (e.g. per-bot-per-chat) so one busy chat never
 *   makes another chat's commands wait. `category`/`timeoutMs` control how
 *   long this specific job is allowed to run before being treated as stuck
 *   (see CATEGORY_TIMEOUT_MS / resolveTimeoutMs above).
 */
export function runWithFreeQueue(isPremium, task, options = {}) {
    const key = String(options.key || 'default')
    const timeoutMs = resolveTimeoutMs(options)
    const max = isPremium ? DEFAULT_CONCURRENCY.premium : DEFAULT_CONCURRENCY.free
    let lane = lanes.get(key)
    if (!lane) {
        lane = { running: 0, wait: [], maxConcurrent: max }
        lanes.set(key, lane)
    }
    // Raise lane cap if a Premium job arrives on a free-sized lane
    if (isPremium && lane.maxConcurrent < DEFAULT_CONCURRENCY.premium) {
        lane.maxConcurrent = DEFAULT_CONCURRENCY.premium
    }

    return new Promise((resolve, reject) => {
        const waitCap = isPremium ? MAX_WAIT.premium : MAX_WAIT.free
        if (lane.running >= lane.maxConcurrent && lane.wait.length >= waitCap) {
            reject(new Error('Too many concurrent commands. Please try again shortly.'))
            return
        }
        lane.wait.push({ task, resolve, reject, isPremium: !!isPremium, timeoutMs })
        pump(lane)
    })
}

export function freeQueueLength() {
    let n = 0
    for (const lane of lanes.values()) n += lane.wait.length
    return n
}
