/**
 * Lightweight concurrency control with Premium priority.
 * - No serial free-user queue that stalls Premium.
 * - Per-chat lanes; when busy, Premium waiters are started first.
 * - Env: CMD_CONCURRENCY_FREE, CMD_CONCURRENCY_PREMIUM, CMD_TIMEOUT_MS,
 *   CMD_TIMEOUT_MEDIUM_MS, CMD_TIMEOUT_HEAVY_MS
 *
 * Timeout root cause (2026-09): sebelumnya SATU JOB_TIMEOUT_MS flat (45s) dipakai
 * untuk semua command, jadi command berat (download, API eksternal, media,
 * RPG/database) yang wajar butuh lebih lama ikut kena "Command timed out"
 * padahal prosesnya sendiri masih berjalan normal (bukan hang/deadlock).
 * Solusinya BUKAN menaikkan satu angka global, tapi memberi command lambat
 * kelonggaran sesuai kategorinya, sambil tetap mempertahankan safety timeout
 * supaya command yang benar-benar hang tidak menumpuk selamanya.
 */
const lanes = new Map()

const DEFAULT_CONCURRENCY = {
    free: Number(process.env.CMD_CONCURRENCY_FREE || 3),
    premium: Number(process.env.CMD_CONCURRENCY_PREMIUM || 12)
}

// Tier default (dipakai kalau plugin tidak override timeoutMs sendiri).
// "default": command ringan (tools/info/fun/group/main/dst) -- tetap cepat gagal kalau hang.
// "medium": command yang biasanya nyentuh DB/state lebih berat (rpg/owo/games).
// "heavy": command yang wajar lambat karena API eksternal/download/media (downloader/maker/image/nsfw/donasi).
const DEFAULT_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MS || 45_000)
const MEDIUM_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MEDIUM_MS || 60_000)
const HEAVY_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_HEAVY_MS || 120_000)

const CATEGORY_TIMEOUT_MS = {
    downloader: HEAVY_TIMEOUT_MS,
    maker: HEAVY_TIMEOUT_MS,
    image: HEAVY_TIMEOUT_MS,
    nsfw: HEAVY_TIMEOUT_MS,
    donasi: HEAVY_TIMEOUT_MS,
    rpg: MEDIUM_TIMEOUT_MS,
    owo: MEDIUM_TIMEOUT_MS,
    games: MEDIUM_TIMEOUT_MS
}

const MAX_WAIT = {
    free: Number(process.env.CMD_WAIT_FREE || 25),
    premium: Number(process.env.CMD_WAIT_PREMIUM || 60)
}

/**
 * Timeout untuk satu job: prioritas ke override eksplisit (plugin.timeoutMs),
 * lalu tier berdasarkan category, baru fallback ke default flat lama.
 */
function resolveTimeoutMs(category, overrideMs) {
    if (Number.isFinite(overrideMs) && overrideMs > 0) return overrideMs
    if (category && CATEGORY_TIMEOUT_MS[category]) return CATEGORY_TIMEOUT_MS[category]
    return DEFAULT_TIMEOUT_MS
}

function withTimeout(task, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            // Catatan penting: task yang sudah terlanjur jalan TIDAK di-cancel di sini --
            // Promise-nya tetap lanjut jalan di background dan hasil akhirnya (resolve/reject)
            // diabaikan lewat guard `if (settled) return` di bawah. Ini sengaja: memutus
            // command dari sisi user (biar lane/queue tidak stuck & command lain tetap
            // diproses) tanpa perlu benar-benar membunuh proses async yang sedang berjalan
            // (mis. fetch/ffmpeg yang tidak selalu bisa dibatalkan dengan aman).
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
 *   - category: dipakai untuk memilih tier timeout (lihat CATEGORY_TIMEOUT_MS).
 *   - timeoutMs: override eksplisit per-plugin, menang atas category.
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

    const timeoutMs = resolveTimeoutMs(options.category, options.timeoutMs)

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
