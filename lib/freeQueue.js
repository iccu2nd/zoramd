/**
 * Lightweight concurrency control (NOT a free-user queue).
 * Commands run directly with a per-chat concurrency limit and timeout.
 * Premium accounts get a higher concurrency budget.
 */
const lanes = new Map() // key -> { running: number, wait: [] }

const DEFAULT_CONCURRENCY = {
    free: Number(process.env.CMD_CONCURRENCY_FREE || 2),
    premium: Number(process.env.CMD_CONCURRENCY_PREMIUM || 6)
}
const JOB_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MS || 45_000)

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
        lane = { running: 0, wait: [] }
        lanes.set(key, lane)
    }

    return new Promise((resolve, reject) => {
        const start = async () => {
            lane.running++
            try {
                resolve(await withTimeout(task))
            } catch (e) {
                reject(e)
            } finally {
                lane.running--
                if (lane.wait.length) {
                    const next = lane.wait.shift()
                    next()
                } else if (lane.running === 0) {
                    lanes.delete(key)
                }
            }
        }
        if (lane.running < max) start()
        else {
            if (lane.wait.length >= (isPremium ? 40 : 20)) {
                reject(new Error('Too many concurrent commands. Please try again shortly.'))
                return
            }
            lane.wait.push(start)
        }
    })
}

/** @deprecated kept for compatibility */
export function freeQueueLength() {
    let n = 0
    for (const lane of lanes.values()) n += lane.wait.length
    return n
}
