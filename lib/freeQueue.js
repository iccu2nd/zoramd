/**
 * Lightweight concurrency control with Premium priority.
 * - No serial free-user queue that stalls Premium.
 * - Per-chat lanes; when busy, Premium waiters are started first.
 * - Env: CMD_CONCURRENCY_FREE, CMD_CONCURRENCY_PREMIUM, CMD_TIMEOUT_MS
 */
const lanes = new Map()

const DEFAULT_CONCURRENCY = {
    free: Number(process.env.CMD_CONCURRENCY_FREE || 3),
    premium: Number(process.env.CMD_CONCURRENCY_PREMIUM || 12)
}
const JOB_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MS || 45_000)
const MAX_WAIT = {
    free: Number(process.env.CMD_WAIT_FREE || 25),
    premium: Number(process.env.CMD_WAIT_PREMIUM || 60)
}

function withTimeout(task) {
    return new Promise((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error('Command timed out'))
        }, JOB_TIMEOUT_MS)
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
        Promise.resolve()
            .then(() => withTimeout(job.task))
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
 * @param {{ key?: string }} options
 */
export function runWithFreeQueue(isPremium, task, options = {}) {
    const key = String(options.key || 'default')
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
        lane.wait.push({ task, resolve, reject, isPremium: !!isPremium })
        pump(lane)
    })
}

export function freeQueueLength() {
    let n = 0
    for (const lane of lanes.values()) n += lane.wait.length
    return n
}
