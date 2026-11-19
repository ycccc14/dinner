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

console.log(`\nAll ${n} sync server tests passed.`);
