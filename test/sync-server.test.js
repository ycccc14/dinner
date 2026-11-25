// node test/sync-server.test.js — the sync server (server/Code.gs) with stand-ins for Google's services.
import assert from 'node:assert/strict';
import { fakeServer } from './sync-fake.js';

let n = 0;
const test = (name, fn) => { fn(); console.log(`  ✓ ${++n}. ${name}`); };
const S = fakeServer();
const { post } = S;

test('setup, ping, bad requests', () => {
  assert.equal(S.G.setup(), 'ok');
  assert.ok(S.props.ROOT);
  assert.equal(post({ fn: 'ping' }).ok, true);
  assert.equal(JSON.parse(S.G.doGet().text).app, 'dinner-sync');
  assert.equal(post('not json').ok, false);
  assert.equal(post({ fn: 'pull', code: 'NOPE', since: 0 }).ok, false);
  assert.match(post({ fn: 'pull', code: 'ABCD-EFGH-JKLM', since: 0 }).error, /同步码不对/);
});

const { code } = post({ fn: 'create' });
test('create a space: 12-character code, hello works with or without dashes', () => {
  assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
  assert.equal(post({ fn: 'hello', code }).rev, 0);
  assert.equal(post({ fn: 'hello', code: code.toLowerCase().replace(/(.{4})/g, '$1-') }).ok, true);
  assert.notEqual(post({ fn: 'create' }).code, code);
});

test('push → pull; nothing new is cheap', () => {
  const r = post({ fn: 'push', code, items: [
    { store: 'logs', id: 'l1', at: 100, rec: { id: 'l1', dishId: 'tomato-egg', date: '2026-11-19' } },
    { store: 'shop', id: 's1', at: 100, rec: { id: 's1', name: '鸡蛋' } },
    { store: 'kv', id: 'settings', at: 100, rec: {} }, // not a synced store → ignored
  ] });
  assert.equal(r.rev, 1); assert.equal(r.accepted, 2);
  const p = post({ fn: 'pull', code, since: 0 });
  assert.equal(p.rev, 1);
  assert.deepEqual(p.changes.map((c) => c.id).sort(), ['l1', 's1']);
  const reads = S.stats.reads;
  assert.deepEqual(post({ fn: 'pull', code, since: 1 }).changes, []);
  assert.equal(S.stats.reads, reads, 'an up-to-date phone does not make the server read Drive');
});

test('later change wins; deletes travel; only newer revisions are sent', () => {
  assert.equal(post({ fn: 'push', code, items: [{ store: 'shop', id: 's1', at: 50, rec: { id: 's1', name: '旧的' } }] }).accepted, 0, 'older change ignored');
  post({ fn: 'push', code, items: [{ store: 'shop', id: 's1', at: 200, rec: { id: 's1', name: '鸡蛋 x2' } }] });
  post({ fn: 'push', code, items: [{ store: 'logs', id: 'l1', at: 300, del: true }] });
  const p = post({ fn: 'pull', code, since: 1 });
  assert.equal(p.rev, 3);
  assert.deepEqual(p.changes.sort((a, b) => a.at - b.at), [{ store: 'shop', id: 's1', at: 200, rec: { id: 's1', name: '鸡蛋 x2' } }, { store: 'logs', id: 'l1', at: 300, del: true }]);
  assert.equal(post({ fn: 'push', code, items: [] }).rev, 3, 'an empty push does not bump the revision');
});

test('photos: stored once, fetched by hash, junk refused', () => {
  const data = 'data:image/jpeg;base64,' + 'A'.repeat(50000);
  assert.equal(post({ fn: 'photo-put', code, id: 'abc123', data }).ok, true);
  post({ fn: 'photo-put', code, id: 'abc123', data });
  const sid = Object.keys(S.props).find((k) => k.startsWith('S_') && S.folders[S.props[k]].files.some((f) => f.name === 'abc123.txt'));
  assert.equal(S.folders[S.props[sid]].files.filter((f) => f.name === 'abc123.txt').length, 1);
  assert.equal(post({ fn: 'photo-get', code, id: 'abc123' }).data, data);
  assert.equal(post({ fn: 'photo-get', code, id: 'ffff' }).ok, false);
  assert.equal(post({ fn: 'photo-put', code, id: 'x1', data: '<script>' }).ok, false);
});

test('spaces are separate', () => {
  const other = post({ fn: 'create' }).code;
  assert.deepEqual(post({ fn: 'pull', code: other, since: 0 }).changes, []);
  assert.equal(post({ fn: 'photo-get', code: other, id: 'abc123' }).ok, false);
});

test('a broken data.json stops the sync instead of wiping the history; a daily backup is kept', () => {
  const c = post({ fn: 'create' }).code;
  post({ fn: 'push', code: c, items: [{ store: 'logs', id: 'keep', at: 10, rec: { id: 'keep', dishId: 'a' } }] });
  post({ fn: 'push', code: c, items: [{ store: 'logs', id: 'keep2', at: 20, rec: { id: 'keep2', dishId: 'b' } }] });
  const folder = S.folders[S.props[Object.keys(S.props).find((k) => k.startsWith('S_') && S.folders[S.props[k]].files.some((f) => f.name === 'data.json' && f.content.includes('keep2')))]];
  const bak = folder.files.find((f) => f.name === 'data.bak.json');
  assert.ok(bak && bak.content.includes('"keep"') && !bak.content.includes('keep2'), 'the version before today\'s first change is kept');
  const writes = folder.files.filter((f) => f.name === 'data.bak.json').length;
  post({ fn: 'push', code: c, items: [{ store: 'logs', id: 'keep3', at: 30, rec: { id: 'keep3' } }] });
  assert.equal(folder.files.filter((f) => f.name === 'data.bak.json').length, writes, 'one backup file');
  assert.ok(!bak.content.includes('keep2'), 'backup made at most once a day');
  const data = folder.files.find((f) => f.name === 'data.json');
  const good = data.content;
  for (const junk of ['{"rev":5,"items":{"x', '', 'null', '[]', '{"rev":"7","items":{}}', '{"rev":3,"items":[]}']) {
    data.content = junk;
    const r = post({ fn: 'push', code: c, items: [{ store: 'logs', id: 'new', at: 40, rec: { id: 'new' } }] });
    assert.equal(r.ok, false, 'push refused for ' + JSON.stringify(junk));
    assert.match(r.error, /读不出来/);
    assert.equal(data.content, junk, 'nothing was written over it');
    assert.equal(post({ fn: 'pull', code: c, since: 0 }).ok, false, 'pull says so too');
  }
  data.content = good;
  assert.equal(post({ fn: 'push', code: c, items: [{ store: 'logs', id: 'new', at: 40, rec: { id: 'new' } }] }).ok, true, 'works again once repaired');
  assert.deepEqual(post({ fn: 'pull', code: c, since: 0 }).changes.map((x) => x.id).sort(), ['keep', 'keep2', 'keep3', 'new']);
});

test('limits: photo size / type / count, batch size, record size, number of spaces', () => {
  const c = post({ fn: 'create' }).code;
  assert.equal(post({ fn: 'photo-put', code: c, id: 'aa11', data: 'data:image/jpeg;base64,' + 'A'.repeat(2600000) }).error, 'photo too big');
  assert.equal(post({ fn: 'photo-put', code: c, id: 'aa12', data: 'data:image/svg+xml;base64,AAAA' }).error, 'bad photo', 'only jpeg / png / webp');
  S.props.MAX_PHOTOS = '2';
  assert.equal(post({ fn: 'photo-put', code: c, id: 'b1', data: 'data:image/png;base64,AAAA' }).ok, true);
  assert.equal(post({ fn: 'photo-put', code: c, id: 'b2', data: 'data:image/png;base64,AAAA' }).ok, true);
  assert.equal(post({ fn: 'photo-put', code: c, id: 'b1', data: 'data:image/png;base64,AAAA' }).ok, true, 'one already stored is fine');
  assert.equal(post({ fn: 'photo-put', code: c, id: 'b3', data: 'data:image/png;base64,AAAA' }).error, 'photo limit');
  delete S.props.MAX_PHOTOS;
  const many = Array.from({ length: 251 }, (_, i) => ({ store: 'shop', id: 's' + i, at: 1, rec: { id: 's' + i } }));
  assert.equal(post({ fn: 'push', code: c, items: many }).ok, false, 'more than 250 at once');
  const r = post({ fn: 'push', code: c, items: [
    { store: 'logs', id: 'huge', at: 1, rec: { id: 'huge', note: 'x'.repeat(60000) } },
    { store: 'logs', id: 'fine', at: 1, rec: { id: 'fine', note: 'ok' } },
  ] });
  assert.equal(r.accepted, 1); assert.equal(r.skipped, 1, 'an oversized record is skipped, the rest still goes in');
  S.props.MAX_ITEMS = '2';
  const r2 = post({ fn: 'push', code: c, items: [{ store: 'logs', id: 'n1', at: 2, rec: { id: 'n1' } }, { store: 'logs', id: 'n2', at: 2, rec: { id: 'n2' } }, { store: 'logs', id: 'fine', at: 3, rec: { id: 'fine', note: 'edited' } }] });
  assert.equal(r2.accepted, 2, 'full space: new records refused, edits to existing ones still accepted');
  delete S.props.MAX_ITEMS;
  const spaces = Object.keys(S.props).filter((k) => k.startsWith('S_')).length;
  S.props.MAX_SPACES = String(spaces);
  assert.match(post({ fn: 'create' }).error, /满了/);
  S.props.MAX_SPACES = String(spaces + 1);
  assert.equal(post({ fn: 'create' }).ok, true, 'the limit can be raised in Script Properties');
  delete S.props.MAX_SPACES;
});

test('sync codes are not repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(post({ fn: 'create' }).code);
  assert.equal(seen.size, 20);
});

console.log(`\nAll ${n} sync server tests passed.`);
