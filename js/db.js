// IndexedDB storage. Everything stays on this phone; backups are JSON files the user exports.
// dishes: the user's records per dish (favourite, hidden, saved links, edits) and their own dishes
// logs: every time a dish was cooked · plan: { id: 'YYYY-MM-DD', dishes: [ids] } · shop: shopping list · kv: settings
const NAME = 'dinner';
export const STORES = ['dishes', 'logs', 'plan', 'shop', 'kv'];
let dbp = null;

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
export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await finish(tx);
  return value;
}
export async function putMany(store, values) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  for (const v of values) tx.objectStore(store).put(v);
  return finish(tx);
}
export async function del(store, id) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return finish(tx);
}

export async function dump() {
  const out = { app: 'dinner', version: 1, exportedAt: new Date().toISOString() };
  for (const s of STORES) out[s] = await all(s);
  return out;
}

// mode 'replace' wipes first; 'merge' keeps existing records and overwrites same ids.
export async function restore(data, mode) {
  if (!data || data.app !== 'dinner') throw new Error('这不是「今晚吃啥」的备份文件');
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const st = tx.objectStore(s);
    if (mode === 'replace') st.clear();
    for (const v of data[s] || []) st.put(v);
  }
  return finish(tx);
}

export async function wipe() {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  return finish(tx);
}
