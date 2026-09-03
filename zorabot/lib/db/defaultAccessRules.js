/**
 * Default Access Rule per featureKey.
 *
 * Banyak plugin dulu punya pengecekan permission HARDCODED di dalam file-nya sendiri
 * (mis. `if (!m.isOwner) return m.reply(...)`), yang gak nyambung sama sekali ke
 * checkbox Access Rule di dashboard -- akibatnya walau di-ceklis "Admin grup" di web,
 * command tetap keblokir kalau bukan owner (karena plugin-nya sendiri yang nge-block,
 * bukan sistem featureGate).
 *
 * Setelah hardcoded check itu dicabut dari plugin, featureGate (lib/featureGate.js)
 * jadi SATU-SATUNYA yang menentukan siapa boleh pakai command apa, sesuai dashboard.
 * Supaya perilaku default TIDAK berubah pas hardcoded check dicabut (command yang
 * dulunya owner-only jangan tiba-tiba jadi publik), featureKey di bawah ini dikasih
 * default accessRules yang sama persis kayak hardcoded check aslinya. Admin tetap bisa
 * override lewat dashboard kapan aja -- begitu mereka simpan lewat Feature Settings,
 * nilai dashboard yang menang, bukan default ini lagi.
 */
export const DEFAULT_ACCESS_RULES = {
    // --- owner-only (dulu: if (!m.isOwner) / if (!isOwner)) ---
    addmsg: ['owner'],
    addowner: ['owner'],
    addprem: ['owner'],
    addsapa: ['owner'],
    autoread: ['owner'],
    autotyping: ['owner'],
    ban: ['owner'],
    blockcmd: ['owner'],
    bc: ['owner'],
    cheat: ['owner'],
    delmsg: ['owner'],
    delprem: ['owner'],
    delsapa: ['owner'],
    df: ['owner'],
    err: ['owner'],
    gconly: ['owner'],
    gp: ['owner'],
    grepplugin: ['owner'],
    join: ['owner'],
    listban: ['owner'],
    listblockcmd: ['owner'],
    listgc: ['owner'],
    listprem: ['owner'],
    listsapa: ['owner'],
    mode: ['owner'],
    noprefix: ['owner'],
    out: ['owner'],
    owoboost: ['owner'],
    restart: ['owner'],
    sf: ['owner'],
    sf2: ['owner'],
    unban: ['owner'],
    unblockcmd: ['owner'],
    upch: ['owner'],

    // --- admin grup-only (dulu: if (!isAdmin)) ---
    antidelete: ['admin'],
    antilink: ['admin'],
    antilottie: ['admin'],
    close: ['admin'],
    open: ['admin'],
    demote: ['admin'],
    promote: ['admin'],
    kick: ['admin'],
    goodbye: ['admin'],
    welcome: ['admin'],
    hidetag: ['admin'],
    rpg: ['admin'],
    worldevent: ['admin'],
    setmaxwarn: ['admin'],
    delwarn: ['admin'],
    warn: ['admin'],
    swgc: ['admin'],

    // --- admin grup ATAU owner (dulu: if (!isAdmin && !m.isOwner)) ---
    add: ['admin', 'owner'],
    blacklist: ['admin', 'owner'],
    unblacklist: ['admin', 'owner'],
    antispam: ['admin', 'owner']
}
