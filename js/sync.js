// 两人同步: phones that share a 同步码 keep the same dishes, records, menu and shopping list.
// The server is a Google Apps Script web app (server/Code.gs) that keeps the data in the owner's Google Drive.
// Each change carries its time; when both phones changed the same thing, the later change wins.
// Photos are uploaded once (by content hash) and fetched by the other phone when it first sees them.
import * as DB from './db.js';
import { cleanRecord, safeId, safePhoto } from './logic.js';

export const SYNC_URL = 'https://script.google.com/macros/s/AKfycbxPsKQwN_PYYhSI4smXEy9uk1tEl0i0kXmUiHOhpT9yNX7KLPWH_UYGiDgBvXJPHBhUfg/exec';
const url = () => (typeof window !== 'undefined' && window.__DINNER_SYNC_URL) || SYNC_URL; // tests use a local stand-in
const EVERY = 5000; // while the app is open, look for the other phone's changes this often

let cfg = null; // { code, rev, photos: [hashes the server has] }
let hooks = { onChange() {}, onStatus() {} };
let busy = false;
let again = false;
let timer = null;
let soon = null;
export const status = { on: false, syncing: false, lastOk: 0, error: '' };

const ALPH = /[^A-Z0-9]/g;
export const cleanCode = (c) => String(c || '').toUpperCase().replace(/O/g, '0').replace(ALPH, '');
export const fmtCode = (c) => cleanCode(c).replace(/(.{4})(?=.)/g, '$1-');
export const code = () => (cfg ? fmtCode(cfg.code) : '');

async function call(body) {
  const r = await fetch(url(), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  if (!r.ok) throw new Error(`同步服务器没有回应（${r.status}）`);
  let j;
  try { j = await r.json(); } catch (e) { throw new Error('同步服务器还没准备好'); }
  if (!j.ok) throw Object.assign(new Error(j.error || '同步失败'), { answered: true }); // the server said no (not a network problem)
  return j;
}
const saveCfg = () => DB.putRaw('kv', { id: '_sync', value: cfg });

async function hash(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function setStatus(p) { Object.assign(status, p); hooks.onStatus(status); }

/** Start: load the saved sync code (if any) and keep syncing while the app is open. */
export async function init(h) {
  hooks = { ...hooks, ...h };
  const r = await DB.get('kv', '_sync');
  cfg = r && r.value && r.value.code ? r.value : null;
  status.on = !!cfg;
  DB.onLocalChange(() => schedule(800));
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
    addEventListener('online', () => schedule(0));
  }
  clearInterval(timer);
  timer = setInterval(() => { if (cfg && !(typeof document !== 'undefined' && document.hidden)) syncNow(); }, EVERY);
  if (cfg) schedule(0);
}

export function schedule(ms) {
  if (!cfg) return;
  clearTimeout(soon);
  soon = setTimeout(syncNow, ms || 0);
}

/** First phone: makes a new 同步码 and uploads everything on this phone. */
export async function create() {
  const r = await call({ fn: 'create' });
  cfg = { code: r.code, rev: 0, photos: [] };
  await saveCfg();
  await DB.markAll();
  setStatus({ on: true, error: '' });
  await syncNow();
  return fmtCode(r.code);
}
/** Other phone: joins with the code; its own data is merged in, then it gets everything from the other phone. */
export async function join(c) {
  const clean = cleanCode(c);
  if (clean.length !== 12) throw new Error('同步码是 12 位，像 ABCD-EFGH-JKLM');
  await call({ fn: 'hello', code: clean });
  cfg = { code: clean, rev: 0, photos: [] };
  await saveCfg();
  await DB.markAll();
  setStatus({ on: true, error: '' });
  await syncNow();
}
/** Stop syncing on this phone (its data stays; the other phone is not affected). */
export async function leave() {
  cfg = null;
  await DB.delRaw('kv', '_sync');
  await DB.clearOutbox();
  setStatus({ on: false, error: '', lastOk: 0 });
}

/** Send this phone's changes, then fetch the other phone's. Safe to call any time. */
export async function syncNow() {
  if (!cfg) return;
  if (busy) { again = true; return; }
  busy = true;
  setStatus({ syncing: true });
  try {
    do {
      again = false;
      await push();
      const n = await pull();
      setStatus({ lastOk: Date.now(), error: '' });
      if (n) await hooks.onChange(n);
    } while (again && cfg);
  } catch (e) {
    setStatus({ error: navigator.onLine === false ? '没联网，联网后会自动同步' : e.message || String(e) });
  } finally {
    busy = false;
    setStatus({ syncing: false });
  }
}

async function push() {
  const out = await DB.pending();
  const keys = Object.keys(out);
  if (!keys.length) return;
  const items = [];
  for (const k of keys) {
    const i = k.indexOf('|');
    const store = k.slice(0, i);
    const idTxt = k.slice(i + 1);
    const e = out[k];
    const rec = e.del ? null : (await DB.get(store, idTxt)) || (await DB.get(store, Number(idTxt)));
    if (e.del || !rec) { items.push({ store, id: idTxt, at: e.at, del: true }); continue; }
    items.push({ store, id: rec.id, at: e.at, rec: await withPhotoRef(rec) });
  }
  for (let i = 0; i < items.length; i += 200) { // keep each request small
    const part = items.slice(i, i + 200);
    await call({ fn: 'push', code: cfg.code, items: part });
    await DB.sent(Object.fromEntries(part.map((it) => [`${it.store}|${it.id}`, { at: it.at }])));
  }
}

/** Photos travel separately (once each); the record carries 'ph:<hash>'. */
async function withPhotoRef(rec) {
  if (typeof rec.photo !== 'string' || !rec.photo.startsWith('data:')) return rec;
  const h = await hash(rec.photo);
  if (!cfg.photos.includes(h)) {
    await call({ fn: 'photo-put', code: cfg.code, id: h, data: rec.photo });
    cfg.photos.push(h);
    await saveCfg();
  }
  return { ...rec, photo: 'ph:' + h };
}

async function pull() {
  const r = await call({ fn: 'pull', code: cfg.code, since: cfg.rev });
  if (!r.changes.length) { if (r.rev !== cfg.rev) { cfg.rev = r.rev; await saveCfg(); } return 0; }
  const mine = await DB.pending();
  let n = 0;
  for (const c of r.changes) {
    if (!c || !DB.SYNCED.includes(c.store) || !safeId(c.id)) continue; // not something this app stores
    const key = `${c.store}|${c.id}`;
    if (mine[key] && mine[key].at > c.at) continue; // changed here more recently: ours goes up next
    const local = await DB.get(c.store, c.id);
    if (c.del) {
      if (local) { await DB.delRaw(c.store, c.id); n++; }
      continue;
    }
    if (local && local.updatedAt === c.at) continue; // already have it (often our own change coming back)
    const rec = { ...(c.rec && typeof c.rec === 'object' ? c.rec : {}), id: c.id, updatedAt: c.at };
    if (typeof rec.photo === 'string' && rec.photo.startsWith('ph:')) {
      const h = rec.photo.slice(3);
      if (local && typeof local.photo === 'string' && local.photo.startsWith('data:') && (await hash(local.photo)) === h) rec.photo = local.photo;
      else {
        // A photo the server can't give back must not hold up everything after it: keep the record, skip the picture.
        let p = null;
        try { p = await call({ fn: 'photo-get', code: cfg.code, id: h }); } catch (e) {
          if (!(e.answered && e.message === 'no photo')) throw e; // network / Drive trouble: try the whole pull again later
          console.warn('photo skipped', h, e.message);
        }
        rec.photo = p && safePhoto(p.data) ? p.data : (local && safePhoto(local.photo)) || null;
        if (p && rec.photo === p.data && !cfg.photos.includes(h)) cfg.photos.push(h);
      }
    }
    const safe = cleanRecord(c.store, rec); // the other phone (or whoever has the code) can't inject code into this one
    if (!safe) { console.warn('change skipped', key); continue; }
    await DB.putRaw(c.store, safe);
    n++;
  }
  cfg.rev = r.rev;
  await saveCfg();
  return n;
}
