/**
 * Antrian global untuk bot Free.
 * Premium melewati antrian (langsung proses).
 */
let running = false
const queue = []

export function runWithFreeQueue(isPremium, task) {
    if (isPremium) return Promise.resolve().then(() => task())
    return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject })
        pump()
    })
}

async function pump() {
    if (running) return
    running = true
    while (queue.length) {
        const job = queue.shift()
        try {
            job.resolve(await job.task())
        } catch (e) {
            job.reject(e)
        }
    }
    running = false
}

export function freeQueueLength() {
    return queue.length
}
