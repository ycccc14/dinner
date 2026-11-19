// node test/layout-test.js — every screen and the main sheets at several phone widths, filled with long names:
// fails if text sits outside its box, if the page scrolls sideways, or if zooming is possible.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server.js';
import { openPhone, sleep } from './cdp.js';
import { today, addDays } from '../js/logic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8797;
const WIDTHS = [320, 360, 375, 390, 430];
const T = today();
const LONG = '超级无敌好吃的妈妈牌秘制红烧咖喱椰浆鸡腿饭 Extra Long Name';
const NOTE = '下次多放盐，少放油，火候小一点，酱汁多一点，'.repeat(4);

const data = {
  app: 'dinner', version: 1,
  dishes: [
    { id: 'u1', custom: true, name: LONG, en: 'Mum’s Very Long Secret Recipe Coconut Curry Chicken Rice', emoji: '🍛', cuisine: 'my', type: 'main', time: 135, level: 3, ings: ['鸡腿', '土豆', '咖喱粉', '椰浆', '超级长的一种食材名字测试'], fav: true,
      links: [{ url: 'https://www.xiaohongshu.com/discovery/item/66aa11bb22cc33dd44ee55ff?xsec_token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', title: '这是一篇标题特别特别长的小红书笔记做法分享', src: 'xhs' }], createdAt: 1 },
    { id: 'tomato-egg', fav: true, links: [{ url: 'http://xhslink.com/a/AbCd123', title: '番茄炒蛋', src: 'xhs' }] },
    { id: 'steak', hidden: true },
  ],
  logs: [
    { id: 'l1', dishId: 'u1', date: T, rating: 5, note: NOTE, createdAt: 1 },
    { id: 'l2', dishId: 'tomato-egg', date: T, rating: 3, note: '一般', createdAt: 2 },
    { id: 'l3', dishId: 'tomato-egg', date: addDays(T, -1), rating: 4, createdAt: 3 },
    { id: 'l4', dishId: 'kungpao', date: addDays(T, -2), createdAt: 4 },
  ],
  plan: [{ id: T, dishes: ['u1', 'tomato-egg', 'kungpao', 'pork-stomach-soup'] }, { id: addDays(T, 1), dishes: ['u1'] }],
  shop: [{ id: 's1', name: '一种名字非常非常长的进口有机食材 Organic Imported', for: [LONG, '番茄炒蛋', '宫保鸡丁'], done: false, createdAt: 1 }, { id: 's2', name: '鸡蛋', for: [], done: true, createdAt: 2 }],
  kv: [{ id: 'settings', value: { avoidDays: 5, filter: { cuisine: 'sea', type: 'soup', maxTime: 30, level: 1, favOnly: true } } }],
};

const CHECK = `(() => {
  const BOX = '.card,.btn,.chip,.tag,.fchip,.seg button,.acts button,.stats3 > div,.dcard,.pchip,.padd,.sitem,.cd,.tabs a,#toast,.sheet-head,.sheet-foot,.note,.lnote,.filterbar,.field,.pitem,.lrow,.crow,.trow,.mrow,.rank,.qchips button,.search,.sels label,.link-row,.ing,.weeknav,.top,.bar';
  const W = document.documentElement.clientWidth;
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || el.closest('[hidden],script,style,option,select,textarea,.sheet-closing')) continue;
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    let clipped = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.textOverflow === 'ellipsis' && s.overflow !== 'visible') { clipped = true; break; } }
    if (clipped) continue;
    const r = document.createRange(); r.selectNodeContents(t);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0.5);
    const box = el.closest(BOX); const b = box && box.getBoundingClientRect();
    for (const x of rects) {
      let why = '';
      if (b && (x.left < b.left - 1 || x.right > b.right + 1)) why = 'sticks out sideways of ' + box.className;
      else if (b && !/(auto|scroll)/.test(getComputedStyle(box).overflowY) && (x.top < b.top - 1 || x.bottom > b.bottom + 1)) why = 'sticks out top/bottom of ' + box.className;
      else if (x.left < -1 || x.right > W + 1) why = 'off the screen';
      if (why) { bad.push(why + ': "' + t.textContent.trim().slice(0, 40) + '"'); break; }
    }
  }
  if (document.documentElement.scrollWidth > W + 1) bad.push('page scrolls sideways (' + document.documentElement.scrollWidth + ' > ' + W + ')');
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('.sheet-closing') || !e.getClientRects().length) continue;
    const s = getComputedStyle(e);
    if (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1) { bad.push('scrolls sideways: ' + e.tagName.toLowerCase() + '.' + e.className); break; }
  }
  for (const e of document.querySelectorAll('input:not([type=checkbox]), select, textarea')) {
    if (!e.getClientRects().length || e.closest('.sheet-closing')) continue;
    const r = e.getBoundingClientRect(); const p = e.parentElement.getBoundingClientRect();
    if (r.right > p.right + 1 || r.left < p.left - 1) { bad.push('field wider than its column: ' + (e.name || e.className || e.type)); break; }
  }
  return bad;
})()`;

const srv = await serve(PORT);
const ph = await openPhone({ port: 9348, shots: path.join(HERE, 'shots', 'layout') });
const { js, until, tap, shot } = ph;
const problems = [];
const go = async (hash) => { await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(120); };
const closeAll = async () => { for (let i = 0; i < 4 && (await js('document.querySelectorAll(".sheet-wrap").length')); i++) { await tap('[data-close]'); await sleep(260); } };
let width = 390;
const check = async (where) => {
  await sleep(120);
  const bad = await js(CHECK);
  if (bad.length) { problems.push(`[${width}px] ${where}:\n    ` + [...new Set(bad)].slice(0, 8).join('\n    ')); await shot(`${width}-${where.replace(/[^\w-]+/g, '_')}`); }
};

try {
  await ph.send('Page.addScriptToEvaluateOnNewDocument', { source: 'navigator.canShare = () => false;' });
  await ph.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await until('document.documentElement.dataset.ready === "1"', 'start');
  await js(`(async () => { await window.__dinner.DB.restore(${JSON.stringify(data)}, 'replace'); await window.__dinner.reload(); })()`);

  const caught = await js(`(() => { const d = document.createElement('div'); d.className = 'card'; d.style.width = '120px';
    d.innerHTML = '<span style="white-space:nowrap">This text is far too long for this little box</span>'; document.querySelector('#view').prepend(d);
    const r = ${CHECK}; d.remove(); return r; })()`);
  assert.ok(caught.some((x) => x.includes('sticks out')), 'checker missed a planted overflow');
  console.log('  ✓ checker catches planted overflow');

  assert.ok((await js('document.querySelector("meta[name=viewport]").content')).includes('user-scalable=no'));
  assert.equal(await js('getComputedStyle(document.documentElement).touchAction'), 'pan-y');
  await tap('.tabs a', '记录'); await sleep(150);
  await go('#dish/tomato-egg');
  await tap('[data-act=log-new]'); await sleep(250);
  const small = await js('[...document.querySelectorAll(".sheet-wrap input, .sheet-wrap textarea, input, select")].filter((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 16).length');
  assert.equal(small, 0, 'fields under 16px make iOS zoom in on tap');
  await closeAll();
  console.log('  ✓ no zoom: viewport, touch-action pan-y, 16px fields');

  for (width of WIDTHS) {
    await ph.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });
    for (const h of ['#home', '#dishes', '#dish/u1', '#dish/tomato-egg', '#dish/steak', '#plan', '#log', '#me']) { await go(h); await check(h); }
    // home modes with results
    await go('#home');
    for (const m of ['one', 'combo']) {
      await js(`(() => { const S = window.__dinner.S; S.ui.mode = '${m}'; S.ui.result = 'u1'; S.ui.combo = { meat: 'kungpao', veg: 'u1', soup: 'pork-stomach-soup' }; window.__dinner.render(); })()`);
      await check('#home ' + m);
    }
    await js(`(() => { const S = window.__dinner.S; S.ui.mode = 'fridge'; S.ui.fridge = ['鸡蛋', '鸡肉', '番茄', '土豆', '面条']; S.ui.fridgePick = 'u1'; window.__dinner.render(); })()`);
    await check('#home fridge');
    await js(`(() => { const S = window.__dinner.S; S.ui.mode = 'one'; window.__dinner.render(); })()`);
    // sheets
    await tap('[data-act=filters]'); await sleep(260); await check('filter sheet'); await closeAll();
    await go('#dish/u1');
    await tap('[data-act=log-edit]'); await sleep(260); await check('log sheet'); await closeAll();
    await tap('[data-act=edit-dish]'); await sleep(260); await tap('[data-emoji-open]'); await check('dish form'); await closeAll();
    await tap('[data-act=link-add]'); await sleep(260); await check('link sheet'); await closeAll();
    await tap('[data-act=to-plan]'); await sleep(260); await check('day picker'); await closeAll();
    await go('#plan');
    await tap('[data-act=plan-add]'); await sleep(260); await check('choose dish'); await closeAll();
    console.log(`  ✓ ${width}px checked`);
  }
  if (problems.length) { console.error('\n✗ Layout problems:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('\nLayout test passed: nothing sticks out at ' + WIDTHS.join(', ') + 'px.');
  assert.deepEqual(ph.errors, [], 'console errors');
} catch (e) {
  console.error('\n✗ Layout test failed:', e.message, ph.errors);
  process.exitCode = 1;
} finally {
  ph.close();
  srv.close();
}
