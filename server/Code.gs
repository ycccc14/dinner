// 今晚吃啥 同步 — keeps two (or more) phones in step. Google Apps Script web app, runs as the owner, anyone with the URL
// can call it, but every call needs the 同步码 (sync code). Data lives in the owner's Google Drive:
//   「今晚吃啥 同步数据」/<space>/data.json      every record (dishes / logs / plan / shop) with its time and revision
//   「今晚吃啥 同步数据」/<space>/<hash>.txt     photos (data URLs), stored once each
// Script Properties: ROOT (folder id), S_<space> (space folder id), R_<space> (latest revision, so "nothing new" is cheap).
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
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
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
function readData_(folder) {
  const f = file_(folder, 'data.json');
  if (!f) return { rev: 0, items: {} };
  try { return JSON.parse(f.getBlob().getDataAsString('UTF-8')); } catch (err) { return { rev: 0, items: {} }; }
}
function writeData_(folder, data) {
  const s = JSON.stringify(data);
  const f = file_(folder, 'data.json');
  if (f) f.setContent(s); else folder.createFile('data.json', s, 'application/json');
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
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const data = readData_(folder);
      const rev = data.rev + 1;
      let n = 0;
      for (const it of items) {
        if (!it || STORES_.indexOf(it.store) < 0 || it.id === undefined || it.id === null || typeof it.at !== 'number') continue;
        const key = it.store + '|' + it.id;
        const cur = data.items[key];
        if (cur && cur.at > it.at) continue; // the server has something newer
        data.items[key] = it.del ? { store: it.store, id: it.id, at: it.at, del: true, rev } : { store: it.store, id: it.id, at: it.at, rec: it.rec, rev };
        n++;
      }
      if (n) {
        data.rev = rev;
        writeData_(folder, data);
        props_().setProperty('R_' + sid, String(rev));
      }
      return { ok: true, rev: data.rev, accepted: n };
    } finally { lock.releaseLock(); }
  }
  if (b.fn === 'photo-put') {
    const id = String(b.id || '').replace(/[^a-f0-9]/g, '');
    if (!id || typeof b.data !== 'string' || b.data.indexOf('data:image/') !== 0) throw new Error('bad photo');
    if (!file_(folder, id + '.txt')) folder.createFile(id + '.txt', b.data, 'text/plain');
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
