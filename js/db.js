// IndexedDB storage. Everything stays on this phone; backups are JSON files the user exports.
// dishes: the user's records per dish (favourite, hidden, saved links, edits) and their own dishes
// logs: every time a dish was cooked · plan: { id: 'YYYY-MM-DD', dishes: [ids] } · shop: shopping list · kv: settings
// Two-phone sync (js/sync.js): every local change to a SYNCED store is noted in the outbox (kv '_outbox':
// { 'store|id': { at, del? } }) and records get updatedAt; sync.js sends the outbox and writes the other phone's
// changes back with putRaw / delRaw, which don't go into the outbox. kv ids starting with '_' are this phone only.
import { cleanRecord, cleanKv } from './logic.js';

const NAME = 'dinner';
export const STORES = ['dishes', 'logs', 'plan', 'shop', 'kv'];
export const SYNCED = ['dishes', 'logs', 'plan', 'shop'];
let dbp = null;
let outbox = null; // loaded on first use
let chain = Promise.resolve();
const listeners = [];
/** cb() after any local change to a synced store (sync.js schedules a push). */
export function onLocalChange(cb) { listeners.push(cb); }

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const finish = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export async function all(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, id) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(id));
}
async function rawPut(store, values) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  for (const v of values) tx.objectStore(store).put(v);
  return finish(tx);
}
async function rawDel(store, id) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return finish(tx);
}

// ---------- outbox ----------
async function loadOutbox() {
  if (!outbox) { const r = await get('kv', '_outbox'); outbox = (r && r.value) || {}; }
  return outbox;
}
function note(store, entries) {
  chain = chain.then(async () => {
    const o = await loadOutbox();
    for (const [id, e] of entries) o[`${store}|${id}`] = e;
    await rawPut('kv', [{ id: '_outbox', value: o }]);
  });
  return chain.then(() => listeners.forEach((cb) => cb()));
}
/** Copy of the outbox: { 'store|id': { at, del? } }. */
export async function pending() { await chain; return { ...(await loadOutbox()) }; }
/** Removes outbox entries that were sent, unless they changed again meanwhile. */
export async function sent(map) {
  chain = chain.then(async () => {
    const o = await loadOutbox();
    for (const [k, e] of Object.entries(map)) if (o[k] && o[k].at === e.at) delete o[k];
    await rawPut('kv', [{ id: '_outbox', value: o }]);
  });
  return chain;
}
/** Puts every record of the synced stores in the outbox (joining a sync: this phone's data goes up too). */
export async function markAll() {
  for (const s of SYNCED) {
    const rows = await all(s);
    const now = Date.now();
    for (const r of rows) if (!r.updatedAt) r.updatedAt = now;
    await rawPut(s, rows);
    await note(s, rows.map((r) => [r.id, { at: r.updatedAt }]));
  }
}
export async function clearOutbox() { await chain; outbox = {}; await rawPut('kv', [{ id: '_outbox', value: {} }]); }

// ---------- writes from this phone (noted for sync) ----------
export async function put(store, value) {
  await putMany(store, [value]);
  return value;
}
export async function putMany(store, values) {
  if (!SYNCED.includes(store)) return rawPut(store, values);
  const now = Date.now();
  for (const v of values) v.updatedAt = now;
  await rawPut(store, values);
  return note(store, values.map((v) => [v.id, { at: now }]));
}
export async function del(store, id) {
  await rawDel(store, id);
  if (SYNCED.includes(store)) return note(store, [[id, { at: Date.now(), del: true }]]);
}

// ---------- writes from the other phone (not noted) ----------
export const putRaw = (store, value) => rawPut(store, [value]);
export const delRaw = rawDel;

export async function dump() {
  const out = { app: 'dinner', version: 1, exportedAt: new Date().toISOString() };
  for (const s of STORES) out[s] = await all(s);
  out.kv = out.kv.filter((k) => !String(k.id).startsWith('_')); // sync code and outbox stay on this phone
  return out;
}

/** Only the records of a backup file that pass the checks in logic.js (a file from someone else can't inject code). */
export function cleanBackup(data) {
  const out = {};
  for (const s of STORES) {
    const rows = Array.isArray(data[s]) ? data[s] : [];
    out[s] = rows.map((v) => (s === 'kv' ? cleanKv(v) : cleanRecord(s, v))).filter(Boolean);
  }
  return out;
}

// mode 'replace' wipes first; 'merge' keeps existing records and overwrites same ids.
export async function restore(data, mode) {
  if (!data || data.app !== 'dinner') throw new Error('这不是「今晚吃啥」的备份文件');
  const clean = cleanBackup(data);
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const st = tx.objectStore(s);
    if (mode === 'replace') st.clear();
    for (const v of clean[s]) st.put(v);
  }
  await finish(tx);
  // restored records count as changes from this phone, so the other phone gets them
  for (const s of SYNCED) { const rows = clean[s]; if (rows.length) await note(s, rows.map((r) => [r.id, { at: r.updatedAt || Date.now() }])); }
}

export async function wipe() {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await finish(tx);
  outbox = {};
}
