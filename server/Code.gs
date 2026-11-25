// 今晚吃啥 同步 — keeps two (or more) phones in step. Google Apps Script web app, runs as the owner, anyone with the URL
// can call it, but every call needs the 同步码 (sync code). Data lives in the owner's Google Drive:
//   「今晚吃啥 同步数据」/<space>/data.json      every record (dishes / logs / plan / shop) with its time and revision
//   「今晚吃啥 同步数据」/<space>/<hash>.txt     photos (data URLs), stored once each
//   「今晚吃啥 同步数据」/<space>/data.bak.json  the previous data.json, refreshed at most once a day (for repairs)
// Script Properties: ROOT (folder id), S_<space> (space folder id), R_<space> (latest revision, so "nothing new" is cheap),
// B_<space> (day of the last backup), P_<space> (photos stored); optional limits MAX_SPACES etc., see LIMITS_.
//
// Calls (POST, JSON body; answer is JSON {ok, ...}):
//   {fn:'create'}                          → {code}        new space (first phone)
//   {fn:'hello', code}                     → {rev}         check a code (second phone joining)
//   {fn:'push', code, items:[{store,id,at,del?,rec?}]} → {rev}   newer wins (by `at`, ms)
//   {fn:'pull', code, since}               → {rev, changes:[{store,id,at,del?,rec?}]}
//   {fn:'photo-put', code, id, data} / {fn:'photo-get', code, id} → {data}
// Run `setup` once from the editor to grant Drive access.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STORES_ = ['dishes', 'logs', 'plan', 'shop'];

function doGet() { return out_({ ok: true, app: 'dinner-sync' }); }

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad request' }); }
  try { return out_(handle_(b || {})); } catch (err) { return out_({ ok: false, error: String((err && err.message) || err) }); }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
const props_ = () => PropertiesService.getScriptProperties();

function setup() {
  root_();
  return 'ok';
}

function root_() {
  const p = props_();
  const id = p.getProperty('ROOT');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) { /* deleted: make a new one */ } }
  const f = DriveApp.createFolder('今晚吃啥 同步数据（请勿删除）');
  p.setProperty('ROOT', f.getId());
  return f;
}

function hex_(bytes) { return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join(''); }
function cleanCode_(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function spaceOf_(code) {
  const c = cleanCode_(code);
  if (c.length !== 12) return null;
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'dinner:' + c, Utilities.Charset.UTF_8)).slice(0, 32);
}
function newCode_() {
  // Random bytes from a fresh UUID hashed with the time (Math.random is guessable).
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Date.now() + ':' + Math.random(), Utilities.Charset.UTF_8);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[((bytes[i] + 256) % 256) % ALPHABET.length];
  return s;
}

function folder_(sid) {
  const id = props_().getProperty('S_' + sid);
  return id ? DriveApp.getFolderById(id) : null;
}
function file_(folder, name) {
  const it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}
// A data.json that can't be read (edited by hand, half-written) must NOT be treated as empty: the next push would
// overwrite the whole history. Stop instead, with a message; the owner can put back data.bak.json (one copy a day).
const BROKEN_ = '云端的同步资料读不出来，已暂停同步以免覆盖。请联系 App 作者处理，手机上的资料不受影响。';
function readData_(folder) {
  const f = file_(folder, 'data.json');
  if (!f) return { rev: 0, items: {} };
  let d;
  try { d = JSON.parse(f.getBlob().getDataAsString('UTF-8')); } catch (err) { throw new Error(BROKEN_); }
  if (!d || typeof d !== 'object' || typeof d.rev !== 'number' || !d.items || typeof d.items !== 'object' || Array.isArray(d.items)) throw new Error(BROKEN_);
  return d;
}
function writeData_(sid, folder, data) {
  const s = JSON.stringify(data);
  const f = file_(folder, 'data.json');
  if (!f) { folder.createFile('data.json', s, 'application/json'); return; }
  // Once a day, keep the previous good version as data.bak.json before overwriting.
  const day = new Date().toISOString().slice(0, 10);
  if (props_().getProperty('B_' + sid) !== day) {
    const old = f.getBlob().getDataAsString('UTF-8');
    const bak = file_(folder, 'data.bak.json');
    if (bak) bak.setContent(old); else folder.createFile('data.bak.json', old, 'application/json');
    props_().setProperty('B_' + sid, day);
  }
  f.setContent(s);
}

// Limits, so nobody can fill the owner's Drive or quota with the public URL. Change them in Script Properties
// (MAX_SPACES …) without touching the code.
const LIMITS_ = { MAX_SPACES: 30, MAX_PHOTO: 2500000, MAX_PHOTOS: 3000, MAX_ITEMS: 20000, MAX_BATCH: 250, MAX_REC: 50000 };
function limit_(k) { const v = Number(props_().getProperty(k)); return v > 0 ? v : LIMITS_[k]; }
function spaceCount_() {
  const all = props_().getProperties();
  return Object.keys(all).filter((k) => k.indexOf('S_') === 0).length;
}

function space_(b) {
  const sid = spaceOf_(b.code);
  const folder = sid && folder_(sid);
  if (!folder) throw new Error('同步码不对，或这个同步已经不存在了');
  return { sid, folder };
}

function handle_(b) {
  if (b.fn === 'ping') return { ok: true };
  if (b.fn === 'create') {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (spaceCount_() >= limit_('MAX_SPACES')) throw new Error('同步空间已经满了，请联系 App 作者');
      let code;
      let sid;
      do { code = newCode_(); sid = spaceOf_(code); } while (props_().getProperty('S_' + sid));
      const f = root_().createFolder(sid);
      props_().setProperty('S_' + sid, f.getId());
      props_().setProperty('R_' + sid, '0');
      return { ok: true, code, rev: 0 };
    } finally { lock.releaseLock(); }
  }
  const { sid, folder } = space_(b);
  if (b.fn === 'hello') return { ok: true, rev: Number(props_().getProperty('R_' + sid) || 0) };
  if (b.fn === 'pull') {
    const rev = Number(props_().getProperty('R_' + sid) || 0);
    const since = Number(b.since) || 0;
    if (since >= rev) return { ok: true, rev, changes: [] };
    const data = readData_(folder);
    const changes = Object.keys(data.items).map((k) => data.items[k]).filter((x) => x.rev > since)
      .map((x) => (x.del ? { store: x.store, id: x.id, at: x.at, del: true } : { store: x.store, id: x.id, at: x.at, rec: x.rec }));
    return { ok: true, rev: data.rev, changes };
  }
  if (b.fn === 'push') {
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length > limit_('MAX_BATCH')) throw new Error('一次传太多了');
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const data = readData_(folder);
      const rev = data.rev + 1;
      const maxRec = limit_('MAX_REC');
      let count = Object.keys(data.items).length;
      let n = 0;
      let skipped = 0;
      for (const it of items) {
        if (!it || STORES_.indexOf(it.store) < 0 || it.id === undefined || it.id === null || typeof it.at !== 'number') continue;
        if (!it.del && JSON.stringify(it.rec === undefined ? null : it.rec).length > maxRec) { skipped++; continue; } // one oversized record can't hold up the rest
        const key = it.store + '|' + it.id;
        const cur = data.items[key];
        if (cur && cur.at > it.at) continue; // the server has something newer
        if (!cur && count >= limit_('MAX_ITEMS')) { skipped++; continue; }
        if (!cur) count++;
        data.items[key] = it.del ? { store: it.store, id: it.id, at: it.at, del: true, rev } : { store: it.store, id: it.id, at: it.at, rec: it.rec, rev };
        n++;
      }
      if (n) {
        data.rev = rev;
        writeData_(sid, folder, data);
        props_().setProperty('R_' + sid, String(rev));
      }
      return { ok: true, rev: data.rev, accepted: n, skipped };
    } finally { lock.releaseLock(); }
  }
  if (b.fn === 'photo-put') {
    const id = String(b.id || '').replace(/[^a-f0-9]/g, '');
    if (!id || id.length > 64 || typeof b.data !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(b.data)) throw new Error('bad photo');
    if (b.data.length > limit_('MAX_PHOTO')) throw new Error('photo too big');
    if (file_(folder, id + '.txt')) return { ok: true };
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const np = Number(props_().getProperty('P_' + sid) || 0);
      if (np >= limit_('MAX_PHOTOS')) throw new Error('photo limit');
      folder.createFile(id + '.txt', b.data, 'text/plain');
      props_().setProperty('P_' + sid, String(np + 1));
    } finally { lock.releaseLock(); }
    return { ok: true };
  }
  if (b.fn === 'photo-get') {
    const id = String(b.id || '').replace(/[^a-f0-9]/g, '');
    const f = id && file_(folder, id + '.txt');
    if (!f) return { ok: false, error: 'no photo' };
    return { ok: true, data: f.getBlob().getDataAsString('UTF-8') };
  }
  throw new Error('unknown call');
}
