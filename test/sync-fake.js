// Runs server/Code.gs (the real sync server) in Node, with in-memory stand-ins for Google Drive and friends.
// Used by test/sync-server.test.js and, as a local HTTP endpoint, by test/sync-test.js.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const signed = (b) => Array.from(b).map((x) => (x > 127 ? x - 256 : x));

export function fakeServer() {
  const props = {};
  const folders = {};
  let nid = 0;
  const stats = { reads: 0, writes: 0 };
  const mkFile = (name, content) => ({
    id: 'f' + ++nid, name, content,
    getBlob() { const f = this; stats.reads++; return { getDataAsString: () => f.content }; },
    setContent(s) { stats.writes++; this.content = s; },
  });
  const mkFolder = (name) => {
    const f = {
      id: 'd' + ++nid, name, files: [], subs: [],
      getId() { return this.id; },
      createFolder(n) { const s = mkFolder(n); this.subs.push(s); return s; },
      createFile(n, c) { stats.writes++; const x = mkFile(n, c); this.files.push(x); return x; },
      getFilesByName(n) { const list = this.files.filter((x) => x.name === n); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
    };
    folders[f.id] = f;
    return f;
  };
  const context = {
    console, JSON, Math, Date, Array, Object, String, Number, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, getProperties: () => ({ ...props }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: {
      createFolder: (n) => mkFolder(n),
      getFolderById: (id) => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, v) => signed(crypto.createHash('sha256').update(Buffer.from(v, 'utf8')).digest()),
      getUuid: () => crypto.randomUUID(),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/Code.gs'), 'utf8') + '\nthis.__G = { doGet, doPost, setup };', context);
  const G = context.__G;
  const post = (body) => JSON.parse(G.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
  return { post, G, props, folders, stats };
}
