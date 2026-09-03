/**
 * Plugin Hub / Ekstensi — admin upload kode plugin baru,
 * user pasang ke bot mereka.
 */
import { getMongoDb } from './db/mongo.js'
import { COLLECTIONS } from './db/schema.js'

const COL = COLLECTIONS.SHARED_FEATURES || 'shared_features'

/** In-memory compiled plugins: featureKey -> plugin object */
const compiled = new Map()

export async function listPublishedPlugins({ activeOnly = true } = {}) {
    const db = await getMongoDb()
    const q = activeOnly ? { active: { $ne: false } } : {}
    return db.collection(COL).find(q).sort({ updatedAt: -1 }).toArray()
}

export async function getPublishedPlugin(featureKey) {
    const db = await getMongoDb()
    return db.collection(COL).findOne({ featureKey: String(featureKey).toLowerCase() })
}

/**
 * Compile admin-uploaded code into plugin shape.
 * Accepted forms:
 * 1) Full object: ({ cmd: [...], async run(){} })
 * 2) module.exports / exports.default assignment
 */
export function compilePluginCode(code, featureKey) {
    if (!code || typeof code !== 'string') throw new Error('Kode plugin kosong')
    if (code.length > 80_000) throw new Error('Kode terlalu panjang (max 80KB)')
    const banned = [
        /process\.exit/i,
        /require\s*\(\s*['"]child_process/i,
        /require\s*\(\s*['"]fs/i,
        /from\s+['"]fs['"]/i,
        /from\s+['"]child_process['"]/i
    ]
    for (const re of banned) {
        if (re.test(code)) throw new Error('Kode mengandung pola yang tidak diizinkan')
    }

    let plugin
    const trimmed = code.trim()
    try {
        // Prefer pure object expression: ({ cmd, run })
        // eslint-disable-next-line no-new-func
        plugin = new Function(`"use strict"; return (${trimmed})`)()
    } catch {
        try {
            // module.exports style
            // eslint-disable-next-line no-new-func
            plugin = new Function(
                `"use strict"; const module = { exports: {} }; const exports = module.exports; ${trimmed}; return module.exports.default || module.exports;`
            )()
        } catch (e) {
            throw new Error('Gagal compile: ' + (e.message || e) + '. Pakai format: ({ cmd: [...], async run(m, ctx) {} })')
        }
    }

    if (!plugin || typeof plugin !== 'object') throw new Error('Plugin harus object')
    if (!Array.isArray(plugin.cmd) || !plugin.cmd.length) plugin.cmd = [featureKey]
    if (typeof plugin.run !== 'function' && typeof plugin.onMessage !== 'function') {
        throw new Error('Plugin wajib punya fungsi run() atau onMessage()')
    }
    plugin.category = plugin.category || 'ekstensi'
    plugin.description = plugin.description || ''
    plugin._custom = true
    plugin._featureKey = featureKey
    return plugin
}

export function registerCompiled(featureKey, plugin) {
    compiled.set(String(featureKey).toLowerCase(), plugin)
}

export function unregisterCompiled(featureKey) {
    compiled.delete(String(featureKey).toLowerCase())
}

export function getCompiledPlugin(featureKey) {
    return compiled.get(String(featureKey).toLowerCase()) || null
}

export function getAllCompiled() {
    return compiled
}

/** Load all active plugins from DB into memory (call on boot) */
export async function loadAllCustomPlugins() {
    compiled.clear()
    try {
        const list = await listPublishedPlugins({ activeOnly: true })
        for (const doc of list) {
            if (!doc.code) continue
            try {
                const plugin = compilePluginCode(doc.code, doc.featureKey)
                // Prefer metadata from DB
                if (doc.title) plugin.description = plugin.description || doc.description || doc.title
                if (doc.category) plugin.category = doc.category
                registerCompiled(doc.featureKey, plugin)
            } catch (e) {
                console.error('[ekstensi] gagal load', doc.featureKey, e.message)
            }
        }
        console.log(`[ekstensi] ${compiled.size} plugin custom dimuat`)
    } catch (e) {
        console.error('[ekstensi] loadAll:', e.message)
    }
}

export async function publishPlugin({ featureKey, title, description, category, code, active = true }) {
    const key = String(featureKey || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!key || key.length < 2) throw new Error('featureKey minimal 2 karakter (a-z, 0-9, _, -)')
    if (!code || !String(code).trim()) throw new Error('Kode plugin wajib diisi')

    const plugin = compilePluginCode(String(code), key)
    // ensure cmd includes key
    if (!plugin.cmd.map(c => String(c).toLowerCase()).includes(key)) {
        plugin.cmd = [key, ...plugin.cmd]
    }

    const db = await getMongoDb()
    const doc = {
        featureKey: key,
        title: (title || key).trim().slice(0, 80),
        description: (description || plugin.description || '').trim().slice(0, 400),
        category: (category || plugin.category || 'ekstensi').trim().toLowerCase().slice(0, 40),
        code: String(code),
        active: active !== false,
        updatedAt: new Date()
    }
    await db.collection(COL).updateOne(
        { featureKey: key },
        { $set: doc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
    )
    registerCompiled(key, plugin)
    return db.collection(COL).findOne({ featureKey: key })
}

export async function unpublishPlugin(featureKey) {
    const key = String(featureKey).trim().toLowerCase()
    const db = await getMongoDb()
    await db.collection(COL).deleteOne({ featureKey: key })
    unregisterCompiled(key)
    return true
}
