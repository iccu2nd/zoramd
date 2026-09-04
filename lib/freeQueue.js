/**
 * Antrian global untuk bot Free.
 * Premium melewati antrian (langsung proses).
 *
 * Free tetap serial, tetapi sekarang dibatasi dan punya timeout agar traffic
 * yang macet tidak menahan seluruh bot selamanya.
 */
const MAX_QUEUE = Number(process.env.FREE_QUEUE_MAX || 200)
const JOB_TIMEOUT_MS = Number(process.env.FREE_QUEUE_TIMEOUT_MS || 45_000)
const lanes = new Map()
let freePending = 0

function withTimeout(task) {
    return new Promise((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error('Free queue job timeout'))
        }, JOB_TIMEOUT_MS)
        Promise.resolve().then(task).then((value) => {
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

export function runWithFreeQueue(isPremium, task, options = {}) {
    const key = String(options.key || 'default')
    if (!isPremium && freePending >= MAX_QUEUE) {
        return Promise.reject(new Error('Free queue penuh, coba lagi sebentar'))
    }
    let lane = lanes.get(key)
    if (!lane) {
        lane = { running: false, queue: [] }
        lanes.set(key, lane)
    }
    if (isPremium && lane.queue.length >= 50) {
        return Promise.reject(new Error('Antrian chat penuh, coba lagi sebentar'))
    }
    if (!isPremium) freePending++
    return new Promise((resolve, reject) => {
        lane.queue.push({ task, resolve, reject, isPremium })
        pump(key, lane)
    })
}

async function pump(key, lane) {
    if (lane.running) return
    lane.running = true
    while (lane.queue.length) {
        const job = lane.queue.shift()
        if (!job.isPremium) freePending--
        try {
            job.resolve(await withTimeout(job.task))
        } catch (e) {
            job.reject(e)
        }
    }
    lane.running = false
    if (!lane.queue.length) lanes.delete(key)
}

export function freeQueueLength() {
    return freePending
}
