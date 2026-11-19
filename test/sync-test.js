// node test/sync-test.js — two phones (two separate headless Chromes) sync through the real server code
// (server/Code.gs running locally with stand-ins for Google Drive). Checks both directions, photos, deletes, merging.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPhone, sleep } from './cdp.js';
import { fakeServer } from './sync-fake.js';
import { today, addDays } from '../js/logic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8798;
const PHOTO = path.join(HERE, 'fixtures', 'dish.jpg');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const T = today();
let step = 0;
const ok = (name) => console.log(`  ✓ ${++step}. ${name}`);

const fake = fakeServer();
let calls = 0;
const srv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/sync') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { calls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(fake.post(body))); });
    return;
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

const A = await openPhone({ port: 9349, shots: path.join(HERE, 'shots') });
const B = await openPhone({ port: 9350, shots: path.join(HERE, 'shots') });
const S = (ph, expr) => ph.js(`(() => { const S = window.__dinner.S; return ${expr}; })()`);
const go = async (ph, hash) => { await ph.js(`location.hash = ${JSON.stringify(hash)}`); await sleep(150); };
const WAIT = 15000; // the other phone looks every 5 s

try {
  for (const ph of [A, B]) {
    await ph.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__DINNER_SYNC_URL = "/sync"; navigator.canShare = () => false; navigator.share = undefined;' });
    await ph.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await ph.until('document.documentElement.dataset.ready === "1"', 'app start');
  }
  assert.equal(calls, 0, 'no sync calls before sync is switched on');

  // Phone A: a name, a cooked dish with a photo — before syncing exists
  await go(A, '#me');
  await A.type('[data-set=name]', 'YC');
  await A.until('window.__dinner.S.settings.name === "YC"', 'name saved');
  await go(A, '#dish/tomato-egg');
  await A.tap('[data-act=log-new]');
  await A.tap('[data-star="5"]');
  A.nextFiles([PHOTO]);
  await A.tap('[data-photo]');
  await A.until('document.querySelector(".ph img")', 'photo');
  await A.tap('[data-save]');
  await A.until('window.__dinner.S.logs.length === 1 && !document.querySelector(".sheet-wrap")', 'logged');
  // Phone B: something of its own, to be merged
  await go(B, '#plan');
  await B.type('[data-form=shop-add] [name=item]', '牛奶');
  await B.js('document.querySelector("[data-form=shop-add]").requestSubmit()');
  await B.until('window.__dinner.S.shop.length === 1', 'B shop item');
  ok('two phones with their own data, sync off (no server calls)');

  // A switches sync on
  await go(A, '#me');
  await A.tap('[data-act=sync-create]');
  await A.tap('[data-ok]');
  await A.until('document.querySelector(".bigcode")', 'code shown', WAIT);
  const code = await A.js('document.querySelector(".bigcode").textContent');
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await A.shot('20-sync-code');
  await A.tap('[data-close]');
  await A.until('document.querySelector("#syncst") && document.querySelector("#syncst").textContent.includes("已同步")', 'A synced', WAIT);
  ok(`开启同步 on A → code ${code}, A's data uploaded`);

  // B joins with the code (typed without dashes, lower case)
  await go(B, '#me');
  await B.tap('[data-act=sync-join]');
  await B.type('[name=code]', code.replace(/-/g, '').toLowerCase());
  assert.equal(await B.js('document.querySelector("[name=code]").value'), code, 'code is tidied while typing');
  await B.tap('[data-join]');
  await B.until('window.__dinner.S.logs.length === 1 && !document.querySelector(".sheet-wrap")', 'B got A\'s record', WAIT);
  const bl = await S(B, 'S.logs[0]');
  assert.equal(bl.dishId, 'tomato-egg'); assert.equal(bl.rating, 5); assert.equal(bl.by, 'YC');
  assert.ok(bl.photo.startsWith('data:image/jpeg'), 'the photo came along');
  assert.ok(await B.js('document.querySelector("#syncst").textContent.includes("已同步")'));
  await B.shot('21-sync-joined');
  await A.until('window.__dinner.S.shop.some((x) => x.name === "牛奶")', 'A got B\'s shopping item', WAIT);
  ok('B joins → gets A\'s record + photo + who cooked it; A gets B\'s shopping item (merged)');

  // A plans tomorrow → B; B favourites + deletes → A
  await go(A, '#dish/cola-wings');
  await A.tap('[data-act=to-plan]');
  await A.tap('.daypick .btn', '明天');
  await B.until(`(window.__dinner.S.plan[${JSON.stringify(addDays(T, 1))}] || []).includes("cola-wings")`, 'B sees the plan', WAIT);
  await go(B, '#dish/steak');
  await B.tap('[data-act=fav]');
  await go(B, '#plan');
  await B.tap('.sitem [data-act=shop-del]');
  await B.until('window.__dinner.S.shop.length === 0', 'B deleted');
  await A.until('window.__dinner.S.dishes.find((d) => d.id === "steak").fav && window.__dinner.S.shop.length === 0', 'A sees fav + delete', WAIT);
  ok('A plans tomorrow → B sees it; B favourites a dish and deletes an item → A follows');

  // A is on the 记录 page: the screen updates by itself
  await go(A, '#log');
  await go(B, '#dish/cola-wings');
  await B.tap('[data-act=log-new]');
  await B.tap('[data-save]');
  await A.until('window.__dinner.S.logs.length === 2 && document.querySelectorAll(".lrow").length === 2', 'A\'s screen redraws', WAIT);
  ok('a record made on B shows up on A\'s open screen');

  // B stops syncing: its data stays, A is not affected
  await go(B, '#me');
  await B.tap('[data-act=sync-leave]');
  await B.tap('[data-ok]');
  await B.until('!window.__dinner.Sync.status.on && document.querySelector("[data-act=sync-create]")', 'left');
  assert.equal(await S(B, 'S.logs.length'), 2);
  await sleep(300);
  assert.equal(await S(A, 'S.logs.length'), 2);
  ok('停止同步 on B keeps its data and leaves A alone');

  assert.deepEqual([...A.errors, ...B.errors], [], 'console errors');
  ok('no console errors');
  console.log(`\nSync test passed (${step} steps, ${calls} server calls).`);
} catch (e) {
  await A.shot('zz-sync-A');
  await B.shot('zz-sync-B');
  console.error('\n✗ Sync test failed:', e.message, '\n  errors:', A.errors, B.errors);
  process.exitCode = 1;
} finally {
  A.close();
  B.close();
  srv.close();
}
