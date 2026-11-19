// node test/ui-test.js — drives the real app in an iPhone-sized headless Chrome, the way a user taps it.
// Screenshots go to test/shots/ (gitignored) for a visual check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server.js';
import { openPhone, sleep } from './cdp.js';
import { today, addDays, weekStart, weekDates } from '../js/logic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.UI_PORT) || 8796; // 8795 is left for test/server.js
const PHOTO = path.join(HERE, 'fixtures', 'dish.jpg');
const T = today();
let step = 0;
const ok = (name) => console.log(`  ✓ ${++step}. ${name}`);

const srv = await serve(PORT);
const ph = await openPhone({ port: 9347, shots: path.join(HERE, 'shots') });
const { js, until, tap, type, shot, full } = ph;
const S = (expr) => js(`(() => { const S = window.__dinner.S; return ${expr}; })()`);
const go = async (hash) => { await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(150); };
const text = () => js('document.querySelector("#view").innerText');
const sheetText = () => js('(() => { const s = [...document.querySelectorAll(".sheet-wrap")].pop(); return s ? s.innerText : ""; })()');
const sheets = () => js('document.querySelectorAll(".sheet-wrap").length');
const noOverflow = async (where) => assert.ok(await js('document.documentElement.scrollWidth <= innerWidth + 1'), `page wider than the phone on ${where}`);

try {
  await ph.send('Page.addScriptToEvaluateOnNewDocument', { source: 'navigator.canShare = () => false;' });
  await ph.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await until('document.documentElement.dataset.ready === "1"', 'app start');
  assert.ok((await text()).includes('今晚吃啥'));
  assert.ok((await text()).includes('帮我挑'));
  await shot('01-home-empty');
  ok('starts on 今晚 with an empty plate');

  // 1. Random pick, then "换一个" gives a different dish
  await tap('[data-act=spin]', '帮我挑');
  await until('document.querySelector(".result h2")', 'a dish was picked');
  const first = await S('S.ui.result');
  const name1 = await js('document.querySelector(".result h2").textContent');
  assert.ok(await js('document.querySelector(".result a.xhs").href.startsWith("xhsdiscover://search/result?keyword=")'));
  assert.ok(decodeURIComponent(await js('document.querySelector(".result a.xhs").href')).includes(name1 + ' 做法'), 'XHS searches the dish name');
  await shot('02-picked');
  await tap('[data-act=spin]', '换一个');
  await until(`window.__dinner.S.ui.result && window.__dinner.S.ui.result !== ${JSON.stringify(first)} && document.querySelector(".result")`, 'another dish');
  ok(`random pick (${name1}) → 小红书 search link → 换一个 gives another`);

  // 2. 就它了 → tonight's menu; 做好了 → log with stars, quick note and a photo
  const chosen = await S('S.ui.result');
  const chosenName = await S(`S.dishes.find((d) => d.id === ${JSON.stringify(chosen)}).name`);
  await tap('.result [data-act=choose]');
  await until('document.querySelector(".tonight")', 'tonight card');
  assert.deepEqual(await S(`S.plan[${JSON.stringify(T)}]`), [chosen]);
  assert.ok((await js('document.querySelector(".tonight").innerText')).includes(chosenName));
  await tap('.tonight [data-act=log-new]');
  await until('document.querySelector(".starpick")', 'log sheet');
  await tap('[data-star="4"]');
  assert.ok((await sheetText()).includes('好吃'));
  await tap('.qchips button', '下次多放盐');
  await tap('.qchips button', '少放油');
  assert.equal(await js('document.querySelector("[name=note]").value'), '下次多放盐，少放油');
  ph.nextFiles([PHOTO]);
  await tap('[data-photo]');
  await until('document.querySelector(".ph img")', 'photo picked');
  await full('03-log-sheet');
  await tap('[data-save]');
  await until('window.__dinner.S.logs.length === 1 && !document.querySelector(".sheet-wrap")', 'saved');
  const log = await S('S.logs[0]');
  assert.equal(log.dishId, chosen); assert.equal(log.rating, 4); assert.equal(log.date, T); assert.equal(log.note, '下次多放盐，少放油');
  assert.ok(log.photo.startsWith('data:image/jpeg'));
  assert.ok((await js('document.querySelector(".tonight").innerText')).includes('已记录'));
  assert.ok((await text()).includes('最近做过'));
  ok('就它了 → tonight menu → 做好了 → ★4 + quick notes + photo saved');

  // 3. The note shows up next time the dish comes up, and on its page (with the photo as its picture)
  await js(`(() => { const S = window.__dinner.S; S.ui.result = ${JSON.stringify(chosen)}; window.__dinner.render(); })()`);
  assert.ok((await js('document.querySelector(".result .note").innerText')).includes('下次多放盐，少放油'));
  assert.ok(await js('!!document.querySelector(".result .plate img")'), 'own photo replaces the emoji');
  await go(`#dish/${chosen}`);
  await until('document.querySelector(".dhero")', 'dish page');
  const dp = await text();
  assert.ok(dp.includes('上次的笔记') && dp.includes('下次多放盐') && dp.includes('★★★★☆'));
  assert.ok(await js('document.querySelector(".stats3 b").textContent === "1"'));
  await full('04-dish');
  await noOverflow('dish page');
  ok('上次的笔记 is shown on the next pick and on the dish page');

  // 4. Edit and delete a log
  await tap('.lrow');
  await until('document.querySelector("[data-del]")', 'edit sheet');
  await type('[name=note]', '下次多放盐');
  await tap('[data-save]');
  await until('window.__dinner.S.logs[0].note === "下次多放盐" && !document.querySelector(".sheet-wrap")', 'edited');
  ok('edit a record');

  // 5. Favourite, saved recipe link, menu, shopping from the dish page
  await go('#dish/cola-wings');
  await until('document.querySelector(".dhero")', 'cola wings');
  await tap('[data-act=fav]');
  await until('window.__dinner.S.dishes.find((d) => d.id === "cola-wings").fav', 'fav');
  await tap('[data-act=link-add]');
  await until('document.querySelector("[name=text]")', 'link sheet');
  await type('[name=text]', '超下饭的可乐鸡翅 http://xhslink.com/a/AbCd123，复制本条信息，打开【小红书】App查看精彩内容！');
  assert.equal(await js('document.querySelector("[name=title]").value'), '超下饭的可乐鸡翅');
  await tap('[data-save]');
  await until('window.__dinner.S.dishes.find((d) => d.id === "cola-wings").links.length === 1 && !document.querySelector(".sheet-wrap")', 'link saved');
  assert.equal(await js('document.querySelector(".link-row a").href'), 'http://xhslink.com/a/AbCd123');
  assert.ok((await js('document.querySelector("a.btn.mine").innerText')).includes('超下饭的可乐鸡翅'));
  await tap('[data-act=to-plan]');
  await tap('.daypick .btn', '明天');
  await until(`(window.__dinner.S.plan[${JSON.stringify(addDays(T, 1))}] || []).includes("cola-wings")`, 'planned tomorrow');
  await tap('[data-act=shop-dishes]');
  await until('window.__dinner.S.shop.length === 2', 'shopping items');
  assert.deepEqual((await S('S.shop.map((x) => x.name)')).sort(), ['可乐', '鸡翅'], '姜 is a seasoning');
  await shot('05-dish-actions');
  ok('收藏 · 粘贴小红书链接 · 加入菜单（明天）· 买食材');

  // 6. 两菜一汤
  await go('#home');
  await tap('[data-act=mode][data-v=combo]');
  await tap('[data-act=spin]', '帮我配一桌');
  await until('document.querySelectorAll(".combo .crow").length === 3', 'combo');
  const combo = await S('S.ui.combo');
  const types = await S(`['meat','veg','soup'].map((k) => S.dishes.find((d) => d.id === S.ui.combo[k]).type)`);
  assert.deepEqual(types, ['meat', 'veg', 'soup']);
  await tap('[data-act=combo-reroll][data-k=soup]');
  await until(`window.__dinner.S.ui.combo.soup !== ${JSON.stringify(combo.soup)}`, 'soup rerolled');
  assert.equal(await S('S.ui.combo.meat'), combo.meat);
  await shot('06-combo');
  await tap('[data-act=choose-combo]');
  await until(`window.__dinner.S.plan[${JSON.stringify(T)}].length === 4`, 'combo added to tonight');
  await noOverflow('home with combo');
  ok('两菜一汤: meat + veg + soup, reroll one, 就这些 → tonight');

  // 7. 冰箱有啥
  await tap('[data-act=mode][data-v=fridge]');
  await tap('.fchip', '鸡蛋');
  await tap('.fchip', '番茄');
  await until('document.querySelectorAll(".mrow").length > 3', 'fridge matches');
  const firstMatch = await js('document.querySelector(".mrow b").textContent');
  assert.ok(['番茄炒蛋', '番茄蛋花汤', '西红柿鸡蛋面'].includes(firstMatch), 'best match first: ' + firstMatch);
  await tap('[data-act=fridge-pick]');
  await until('document.querySelector(".result .fx")', 'fridge pick');
  assert.ok((await js('document.querySelector(".result .fx").innerText')).includes('用到'));
  await full('07-fridge');
  ok(`冰箱有啥: 鸡蛋 + 番茄 → ${firstMatch} first, random pick shows what it uses`);

  // 8. Filters
  await tap('[data-act=mode][data-v=one]');
  await tap('[data-act=filters]');
  await until('document.querySelector(".fcount")', 'filter sheet');
  await tap('.chip', '马来西亚');
  await tap('.chip', '30 分钟内');
  assert.ok((await sheetText()).match(/符合条件：\d+ 道菜/));
  await shot('08-filters');
  await tap('.sheet-foot .btn', '完成');
  await until('!document.querySelector(".sheet-wrap")', 'closed');
  assert.ok((await js('document.querySelector(".fsum").textContent')).includes('马来西亚'));
  for (let i = 0; i < 6; i++) {
    await tap('[data-act=spin]');
    await until(`!window.__dinner.S.ui.spinning && document.querySelector(".result")`, 'pick');
    const d = await S('S.dishes.find((x) => x.id === S.ui.result)');
    assert.ok(d.cuisine === 'my' && d.time <= 30, `${d.name} breaks the filter`);
  }
  await tap('[data-act=filters]');
  await tap('[data-reset]');
  await tap('.sheet-foot .btn', '完成');
  await until('window.__dinner.S.settings.filter.cuisine === "all"', 'reset');
  ok('filters (马来西亚, 30 分钟内) are respected; reset works');

  // 8b. 口味 quick row: 少油少盐 / 油炸重口 / back to 日常
  assert.ok(await js('document.querySelector(".taste button.on").textContent.includes("日常家常")'), 'everyday is the default');
  await tap('.taste button', '少油少盐');
  await until('window.__dinner.S.settings.filter.taste === "light"', 'light');
  for (let i = 0; i < 4; i++) {
    await tap('[data-act=spin]');
    await until('!window.__dinner.S.ui.spinning && document.querySelector(".result")', 'pick');
    assert.equal(await S('S.dishes.find((x) => x.id === S.ui.result).taste'), 'light');
  }
  assert.ok((await js('document.querySelector(".result").innerText')).includes('清淡'));
  await shot('08b-light');
  await tap('.taste button', '油炸重口');
  await until('window.__dinner.S.settings.filter.taste === "heavy"', 'heavy');
  await tap('[data-act=spin]');
  await until('!window.__dinner.S.ui.spinning && document.querySelector(".result")', 'pick');
  assert.equal(await S('S.dishes.find((x) => x.id === S.ui.result).taste'), 'heavy');
  await tap('[data-act=mode][data-v=combo]');
  await tap('[data-act=spin]');
  await until('document.querySelectorAll(".combo .crow").length === 3', 'heavy combo');
  assert.deepEqual(await S(`['meat','veg','soup'].map((k) => S.dishes.find((d) => d.id === S.ui.combo[k]).taste === 'heavy')`), [true, false, false]);
  await tap('[data-act=mode][data-v=one]');
  await tap('.taste button', '日常家常');
  await until('window.__dinner.S.settings.filter.taste === "daily"', 'daily');
  assert.equal(await js('document.querySelector(".filterbar .count")'), null, 'defaults show no filter badge');
  ok('口味: 少油少盐 → only light dishes, 油炸重口 → heavy (combo: only the meat dish), back to 日常');

  // 9. 不想吃这个 → never again
  await tap('[data-act=spin]');
  await until('!window.__dinner.S.ui.spinning && document.querySelector(".result")', 'pick');
  const nope = await S('S.ui.result');
  await tap('.result [data-act=nope]');
  await tap('[data-n=hide]');
  await until(`window.__dinner.S.dishes.find((d) => d.id === ${JSON.stringify(nope)}).hidden && window.__dinner.S.ui.result && window.__dinner.S.ui.result !== ${JSON.stringify(nope)} && !window.__dinner.S.ui.spinning`, 'hidden and re-picked');
  ok('不想吃这个 → 以后都别抽到它, then picks again');

  // 10. Library: search, chips, add my own dish with a link
  await go('#dishes');
  await type('[data-lib-q]', '鸡翅');
  await until('document.querySelectorAll(".dcard").length >= 2', 'search');
  assert.ok((await js('document.querySelector("#grid").innerText')).includes('可乐鸡翅'));
  assert.ok(await js('document.activeElement.matches("[data-lib-q]")'), 'typing keeps the keyboard open');
  await type('[data-lib-q]', '');
  await tap('[data-act=lib-chip][data-v=fav]');
  assert.equal(await js('document.querySelectorAll(".dcard").length'), 1);
  await tap('[data-act=lib-chip][data-v=hidden]');
  assert.equal(await js('document.querySelectorAll(".dcard").length'), 1);
  await tap('[data-act=lib-chip][data-v=all]');
  await js('document.querySelector("[data-lib-sel=cuisine]").value = "jk"; document.querySelector("[data-lib-sel=cuisine]").dispatchEvent(new Event("change", { bubbles: true }))');
  assert.ok(await js('[...document.querySelectorAll(".dcard b")].some((b) => b.textContent === "亲子丼") && ![...document.querySelectorAll(".dcard b")].some((b) => b.textContent === "番茄炒蛋")'));
  await shot('09-library');
  await tap('.top [data-act=dish-new]');
  await until('document.querySelector("[name=name]")', 'new dish form');
  await type('[name=name]', '妈妈的咖喱鸡');
  await tap('[data-emoji-open]');
  await tap('[data-emoji="🍛"]');
  await tap('[data-chips=cuisine] .chip', '马来西亚');
  await tap('[data-chips=level] .chip', '普通');
  await type('[name=time]', '45');
  await type('[name=ings]', '鸡腿, 土豆 咖喱粉、椰浆');
  await type('[name=link]', '【妈妈味道咖喱鸡 - 阿May | 小红书 - 你的生活指南】 https://www.xiaohongshu.com/discovery/item/abc123');
  await full('10-new-dish');
  await tap('[data-save]');
  await until('location.hash.startsWith("#dish/u")', 'new dish page');
  const mine = await S('S.dishes.find((d) => d.name === "妈妈的咖喱鸡")');
  assert.equal(mine.emoji, '🍛'); assert.equal(mine.cuisine, 'my'); assert.equal(mine.level, 2); assert.equal(mine.time, 45);
  assert.deepEqual(mine.ings, ['鸡腿', '土豆', '咖喱粉', '椰浆']);
  assert.equal(mine.links[0].title, '妈妈味道咖喱鸡');
  assert.ok((await text()).includes('打开我收藏的做法'));
  ok('菜谱: search keeps focus, 收藏/不抽的 chips, 菜系 select, add my own dish with emoji + 小红书 link');

  // 11. Edit a built-in dish, then restore it
  await go('#dish/steak');
  await until('document.querySelector(".dhero")', 'steak');
  await tap('[data-act=edit-dish]');
  await type('[name=name]', '黑椒牛排');
  await tap('[data-save]');
  await until('window.__dinner.S.dishes.find((d) => d.id === "steak").name === "黑椒牛排"', 'renamed');
  await tap('[data-act=edit-dish]');
  await tap('[data-restore]');
  await until('document.querySelectorAll(".sheet-wrap").length === 2', 'confirm');
  await tap('[data-ok]');
  await until('window.__dinner.S.dishes.find((d) => d.id === "steak").name === "煎牛排"', 'restored');
  ok('edit a built-in dish and restore it');

  // 12. Week menu + shopping list
  await go('#plan');
  await until('document.querySelectorAll(".day").length === 7', 'week');
  const ws = weekStart(T);
  const emptyFuture = weekDates(ws).filter((d) => d >= T && !(d === T || d === addDays(T, 1)));
  await tap('[data-act=fill-week]');
  await until(`${JSON.stringify(emptyFuture)}.every((d) => (window.__dinner.S.plan[d] || []).length === 1)`, 'week filled');
  const before = await S('S.shop.length');
  await tap('[data-act=shop-week]');
  await until(`window.__dinner.S.shop.length > ${before}`, 'shopping list generated');
  await type('[data-form=shop-add] [name=item]', '牛奶 面包');
  await js('document.querySelector("[data-form=shop-add]").requestSubmit()');
  await until('window.__dinner.S.shop.some((x) => x.name === "牛奶") && window.__dinner.S.shop.some((x) => x.name === "面包")', 'typed items');
  await tap('.sitem [data-act=shop-toggle]');
  await until('window.__dinner.S.shop.some((x) => x.done)', 'checked');
  await full('11-plan');
  await noOverflow('plan');
  const n = await S('S.shop.length');
  await tap('[data-act=shop-clear]');
  await until(`window.__dinner.S.shop.length === ${n - 1}`, 'cleared bought');
  // add to a day by searching
  const lastDay = weekDates(ws)[6];
  await tap(`[data-act=plan-add][data-date="${lastDay}"]`);
  await type('.sheet [data-q]', '饺子');
  await tap('.pitem', '饺子');
  await until(`window.__dinner.S.plan[${JSON.stringify(lastDay)}].includes("dumplings")`, 'dumplings added');
  await tap(`[data-act=plan-rm][data-date="${lastDay}"][data-id=dumplings]`);
  await until(`!(window.__dinner.S.plan[${JSON.stringify(lastDay)}] || []).includes("dumplings")`, 'removed');
  ok('菜单: 一键排满 → 生成购物清单 → add/check/clear items → add & remove a dish on a day');

  // 13. Records
  await go('#log');
  await until('document.querySelector(".calgrid")', 'log page');
  const lp = await text();
  assert.ok(lp.includes('做菜记录') && lp.includes('最常做'));
  assert.ok(await js(`!!document.querySelector('.cd.has[data-date="${T}"]')`));
  await tap(`.cd[data-date="${T}"]`);
  await until('document.querySelector(".sheet .lrow")', 'day sheet');
  await shot('12-day');
  await tap('[data-close]');
  await sleep(250);
  await tap('[data-act=month][data-v="-1"]');
  assert.ok(!(await js(`!!document.querySelector('.cd.has[data-date="${T}"]')`)));
  await full('13-log');
  ok('记录: stats, calendar with today marked, day sheet, month navigation');

  // 14. Settings, backup round trip, wipe
  await go('#me');
  await type('[data-set=avoidDays]', '3');
  await until('window.__dinner.S.settings.avoidDays === 3', 'setting saved');
  const backup = await js('window.__dinner.DB.dump().then((d) => JSON.stringify(d))');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dinner-bk-')), 'backup.json');
  fs.writeFileSync(file, backup);
  await tap('[data-act=wipe]');
  await tap('[data-ok]');
  await until('window.__dinner.S.logs.length === 0 && window.__dinner.S.shop.length === 0', 'wiped');
  await go('#me');
  ph.nextFiles([file]);
  await tap('[data-act=import]');
  await until('document.querySelector("[data-ok]")', 'import confirm');
  assert.ok((await sheetText()).includes('1 条记录'));
  await tap('[data-ok]');
  await until('window.__dinner.S.logs.length === 1 && window.__dinner.S.dishes.some((d) => d.name === "妈妈的咖喱鸡")', 'restored');
  ok('settings saved; backup → wipe → import brings everything back');

  // 15. Dark mode look + no errors
  await ph.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await go('#home');
  await tap('[data-act=mode][data-v=one]');
  await tap('[data-act=spin]');
  await until('!window.__dinner.S.ui.spinning && document.querySelector(".result")', 'pick');
  await full('14-dark');
  assert.deepEqual(ph.errors, [], 'console errors');
  ok('dark mode; no console errors');
  console.log(`\nUI test passed (${step} steps). Screenshots in test/shots/`);
} catch (e) {
  await shot('zz-failure');
  console.error('\n✗ UI test failed:', e.message, '\n  errors:', ph.errors);
  process.exitCode = 1;
} finally {
  ph.close();
  srv.close();
}
