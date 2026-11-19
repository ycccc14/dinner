// node test/logic.test.js — the pure logic: dates, picking, fridge matching, week plans, shopping, stats, link parsing.
import assert from 'node:assert/strict';
import { DISHES, EXTRAS, CUISINES, TYPES, FRIDGE, PANTRY, TASTES, TASTE_IDS, GARLIC_MUST } from '../js/dishes.js';
import { whereToBuy, storeOf, STORES } from '../js/shops.js';
import * as L from '../js/logic.js';

const KINDS = ['meat', 'veg', 'soup'];

let n = 0;
const test = (name, fn) => { fn(); console.log(`  ✓ ${++n}. ${name}`); };
const T = '2026-11-19'; // a Thursday

test('library is well-formed', () => {
  const ids = new Set();
  for (const d of DISHES) {
    assert.ok(!ids.has(d.id), 'duplicate id ' + d.id); ids.add(d.id);
    assert.ok(CUISINES[d.cuisine], d.id + ' cuisine'); assert.ok(TYPES[d.type], d.id + ' type');
    assert.ok(d.time > 0 && [1, 2, 3].includes(d.level), d.id + ' time/level');
    assert.ok(d.ings.length && d.ings.every(Boolean), d.id + ' ingredients');
    assert.ok(d.name && d.en && d.emoji, d.id + ' names');
  }
  assert.ok(DISHES.length >= 100, 'at least 100 dishes, got ' + DISHES.length);
  for (const t of KINDS) assert.ok(DISHES.filter((d) => d.type === t).length >= 12, 'enough ' + t);
  const all = [...DISHES, ...EXTRAS];
  assert.equal(new Set(all.map((d) => d.id)).size, all.length, 'extras have their own ids');
  assert.equal(new Set(all.map((d) => d.name)).size, all.length, 'extras have their own names');
  for (const d of EXTRAS) {
    assert.ok(CUISINES[d.cuisine] && TYPES[d.type] && TASTES[d.taste] && d.level === 1 && d.ings.length && d.en, d.id);
    assert.equal(L.garlicOf(d), 'none', d.id + ': suggested dishes need no garlic');
  }
  for (const c of Object.keys(CUISINES)) assert.ok(DISHES.filter((d) => d.cuisine === c).length >= 8, 'enough ' + c);
  assert.equal(new Set(DISHES.map((d) => d.name)).size, DISHES.length, 'unique names');
});

test('dates', () => {
  assert.equal(L.addDays(T, 13), '2026-12-02');
  assert.equal(L.diffDays('2026-11-01', T), 18);
  assert.equal(L.weekStart(T), '2026-11-16');
  assert.equal(L.weekStart('2026-11-16'), '2026-11-16');
  assert.equal(L.weekStart('2026-11-22'), '2026-11-16'); // Sunday belongs to the week before
  assert.equal(L.weekday(T), '周四');
  assert.equal(L.fmtDate(T), '11月19日 周四');
  assert.equal(L.relDays(T, T), '今天');
  assert.equal(L.relDays('2026-11-18', T), '昨天');
  assert.equal(L.relDays('2026-11-05', T), '2 周前');
  assert.equal(L.relDays('2026-08-01', T), '3 个月前');
  const g = L.monthGrid('2026-11'); // 1 Nov 2026 is a Sunday → 6 blanks first
  assert.equal(g.filter((x) => x === null).length, 6);
  assert.equal(g[6], '2026-11-01');
  assert.equal(g.length, 36);
  assert.equal(L.addMonths('2026-12', 1), '2027-01');
  assert.equal(L.addMonths('2026-01', -1), '2025-12');
});

test('merge user records into the library', () => {
  const recs = [{ id: 'tomato-egg', fav: true, links: [{ url: 'http://xhslink.com/a/1' }] }, { id: 'u1', custom: true, name: '妈妈的咖喱', ings: ['鸡肉'] }, { id: 'steak', edited: true, name: '黑椒牛排', time: 25 }];
  const ds = L.mergeDishes(DISHES, recs);
  assert.equal(ds.length, DISHES.length + 1);
  const te = ds.find((d) => d.id === 'tomato-egg');
  assert.ok(te.fav && te.builtin && te.links.length === 1 && te.name === '番茄炒蛋');
  const mine = ds.find((d) => d.id === 'u1');
  assert.ok(!mine.builtin && mine.emoji && mine.cuisine === 'cn' && mine.time === 30, 'custom dishes get defaults');
  assert.equal(ds.find((d) => d.id === 'steak').name, '黑椒牛排');
  assert.deepEqual(L.mergeDishes(DISHES, [{ id: 'steak', links: undefined, fav: null }]).find((d) => d.id === 'steak').links, [], 'missing fields fall back to defaults');
  assert.deepEqual(L.splitIngs('鸡腿, 土豆、洋葱  洋葱\n胡萝卜'), ['鸡腿', '土豆', '洋葱', '胡萝卜']);
});

test('stats per dish: count, last date, average, latest note, photo', () => {
  const logs = [
    { id: 'a', dishId: 'x', date: '2026-11-01', rating: 3, note: '下次多放盐', createdAt: 1 },
    { id: 'b', dishId: 'x', date: '2026-11-10', rating: 5, note: '', photo: 'data:p', createdAt: 2 },
    { id: 'c', dishId: 'y', date: '2026-11-02', createdAt: 3 },
  ];
  const s = L.dishStats(logs);
  assert.equal(s.x.count, 2); assert.equal(s.x.last, '2026-11-10'); assert.equal(s.x.avg, 4);
  assert.equal(s.x.lastNote.text, '下次多放盐', 'an empty later note keeps the older one');
  assert.equal(s.x.photo, 'data:p');
  assert.equal(s.y.avg, 0);
  assert.equal(L.streak([{ date: T }, { date: '2026-11-18' }, { date: '2026-11-17' }, { date: '2026-11-15' }], T), 3);
  assert.equal(L.streak([{ date: '2026-11-18' }], T), 1, 'nothing yet today still counts up to yesterday');
  assert.equal(L.streak([{ date: '2026-11-16' }], T), 0);
  assert.equal(L.topDishes(s, 1)[0].id, 'x');
});

const ds = L.mergeDishes(DISHES, []);
const base = { stats: {}, today: T, avoidDays: 5 };

test('pickOne respects filters, hidden and skip', () => {
  const rng = L.seeded(1);
  for (let i = 0; i < 200; i++) {
    const r = L.pickOne(ds, { ...base, rng, filter: { cuisine: 'my', type: 'all', maxTime: 30 } });
    assert.ok(r.dish.cuisine === 'my' && r.dish.time <= 30);
  }
  const hidden = ds.map((d) => (d.type === 'soup' && d.id !== 'miso-soup' ? { ...d, hidden: true } : d));
  for (let i = 0; i < 50; i++) assert.equal(L.pickOne(hidden, { ...base, rng, filter: { type: 'soup' } }).dish.id, 'miso-soup');
  assert.equal(L.pickOne(hidden, { ...base, rng, filter: { type: 'soup' }, skip: ['miso-soup'] }), null);
  assert.equal(L.pickOne(ds, { ...base, rng, filter: { favOnly: true } }), null, 'no favourites yet');
});

test('recently cooked dishes are avoided, unless nothing else is left', () => {
  const rng = L.seeded(2);
  const one = ds.filter((d) => d.cuisine === 'sea' && d.type === 'soup'); // only tom yum
  assert.equal(one.length, 1);
  const stats = L.dishStats([{ id: 'l', dishId: 'tom-yum', date: L.addDays(T, -2) }]);
  const r = L.pickOne(one, { ...base, stats, rng });
  assert.equal(r.dish.id, 'tom-yum'); assert.equal(r.relaxed, true);
  const sea = ds.filter((d) => d.cuisine === 'sea');
  for (let i = 0; i < 100; i++) assert.notEqual(L.pickOne(sea, { ...base, stats, rng }).dish.id, 'tom-yum');
  const old = L.dishStats([{ id: 'l', dishId: 'tom-yum', date: L.addDays(T, -5) }]);
  assert.equal(L.pickOne(one, { ...base, stats: old, rng }).relaxed, false, '5 days ago is allowed with avoidDays 5');
  assert.equal(L.pickOne(one, { ...base, stats, rng, avoidDays: 0 }).relaxed, false);
});

test('favourites and good ratings are picked more often, bad ratings less', () => {
  const two = ds.filter((d) => d.id === 'steak' || d.id === 'butter-shrimp').map((d) => (d.id === 'steak' ? { ...d, fav: true } : d));
  const rng = L.seeded(3);
  let steak = 0;
  for (let i = 0; i < 4000; i++) if (L.pickOne(two, { ...base, rng }).dish.id === 'steak') steak++;
  assert.ok(steak > 2800 && steak < 3300, 'favourite ≈ 3:1, got ' + steak);
  const stats = L.dishStats([{ id: 'a', dishId: 'butter-shrimp', date: '2026-10-01', rating: 1 }]);
  const plain = ds.filter((d) => d.id === 'steak' || d.id === 'butter-shrimp');
  let salmon = 0;
  for (let i = 0; i < 4000; i++) if (L.pickOne(plain, { ...base, stats, rng }).dish.id === 'butter-shrimp') salmon++;
  assert.ok(salmon < 1300, 'badly rated dish picked less, got ' + salmon);
});

test('两道菜: 一荤一素 by default; 荤素一锅 + 汤 when asked (cold days)', () => {
  const rng = L.seeded(4);
  for (let i = 0; i < 100; i++) {
    const c = L.pickCombo(ds, { ...base, rng, filter: { type: 'main', cuisine: 'cn' } });
    assert.equal(c.kind, 'mv');
    const got = L.comboIds(c).map((id) => ds.find((d) => d.id === id));
    assert.deepEqual(got.map((d) => d.type), ['meat', 'veg'], 'the type filter is ignored');
    assert.ok(got.every((d) => d.cuisine === 'cn'));
    const s = L.pickCombo(ds, { ...base, rng, combo: 'soup', filter: L.DEFAULT_FILTER });
    const [mixed, soup] = [s.slots.mixed, s.slots.soup].map((id) => ds.find((d) => d.id === id));
    assert.ok(L.isMixed(mixed) && L.hasMeat(mixed) && L.hasVeg(mixed), mixed.name + ' has meat and vegetables');
    assert.equal(soup.type, 'soup');
  }
  const c = L.pickCombo(ds, { ...base, rng, filter: { cuisine: 'west', maxTime: 10 } });
  assert.equal(c.slots.meat, null, 'no western meat dish within 10 minutes');
  const byId = (id) => ds.find((d) => d.id === id);
  for (const id of ['pepper-pork', 'beef-potato', 'jp-curry', 'broccoli-shrimp']) assert.ok(L.isMixed(byId(id)), id);
  for (const id of ['kungpao', 'tomato-egg', 'egg-fried-rice', 'corn-rib-soup', 'mapo-tofu']) assert.ok(!L.isMixed(byId(id)), id);
});

test('soup comes up rarely, unless it is cold', () => {
  const pair = ds.filter((d) => d.id === 'tomato-egg-soup' || d.id === 'tomato-egg');
  const rng = L.seeded(11);
  let warm = 0;
  let cold = 0;
  for (let i = 0; i < 4000; i++) {
    if (L.pickOne(pair, { ...base, rng }).dish.type === 'soup') warm++;
    if (L.pickOne(pair, { ...base, rng, cold: true }).dish.type === 'soup') cold++;
  }
  assert.ok(warm < 1500 && cold > 2000, `soup picked ${warm} (warm) vs ${cold} (cold) of 4000`);
});

test('不用蒜: only dishes that live on garlic are left out', () => {
  const byId = (id) => ds.find((d) => d.id === id);
  for (const id of GARLIC_MUST) assert.equal(L.garlicOf(byId(id)), 'must', id);
  assert.equal(L.garlicOf(byId('cucumber-pork')), 'opt', 'a little garlic → fine without');
  assert.equal(L.garlicOf(byId('tomato-egg')), 'none');
  assert.equal(L.garlicOf({ id: 'u1', name: '蒜蓉茄子', ings: ['茄子'] }), 'must', 'my own 蒜蓉 dish');
  const f = { ...L.DEFAULT_FILTER, noGarlic: true };
  const ok = ds.filter((d) => L.matchesFilter(d, f));
  assert.ok(ok.every((d) => L.garlicOf(d) !== 'must'));
  assert.ok(ok.some((d) => d.id === 'cucumber-pork') && !ok.some((d) => d.id === 'garlic-greens'));
  assert.equal(L.activeFilters(f), 1, 'counts as a filter');
});

test('海鲜: none by default; 可以有 / 只要 海鲜', () => {
  const byId = (id) => ds.find((d) => d.id === id);
  for (const id of ['poached-prawns', 'steamed-fish', 'salmon', 'lala', 'tomato-basa', 'broccoli-shrimp', 'fish-slice-soup', 'char-kway-teow']) assert.equal(L.seafoodOf(byId(id)), 'main', id);
  for (const id of ['seaweed-soup', 'wintermelon-shrimp', 'kangkung']) assert.notEqual(L.seafoodOf(byId(id)), 'none', id);
  assert.equal(L.seafoodOf(byId('seaweed-soup')), 'minor', 'a few dried shrimp only');
  assert.equal(L.seafoodOf(byId('wintermelon-shrimp')), 'main', 'shrimp in the name');
  for (const id of ['tomato-egg', 'cola-wings', 'miso-soup', 'jp-curry']) assert.equal(L.seafoodOf(byId(id)), 'none', id);
  const daily = ds.filter((d) => L.matchesFilter(d, L.DEFAULT_FILTER));
  assert.ok(daily.every((d) => L.seafoodOf(d) !== 'main'), 'no seafood by default');
  assert.equal(L.activeFilters(L.DEFAULT_FILTER), 0);
  const only = ds.filter((d) => L.matchesFilter(d, { ...L.DEFAULT_FILTER, seafood: 'only' }));
  assert.ok(only.length >= 6 && only.every((d) => L.seafoodOf(d) === 'main'));
  assert.ok(ds.filter((d) => L.matchesFilter(d, { ...L.DEFAULT_FILTER, seafood: 'ok' })).length > daily.length);
  assert.equal(L.activeFilters({ ...L.DEFAULT_FILTER, seafood: 'ok' }), 1);
  const rng = L.seeded(21);
  for (let i = 0; i < 50; i++) {
    const c = L.pickCombo(ds, { ...base, rng, filter: { ...L.DEFAULT_FILTER, seafood: 'only' } });
    assert.equal(L.seafoodOf(ds.find((d) => d.id === c.slots.meat)), 'main', 'seafood main dish');
    assert.ok(c.slots.veg, 'the vegetable dish still works');
    const s = L.pickCombo(ds, { ...base, rng, combo: 'soup', filter: L.DEFAULT_FILTER });
    assert.ok(L.comboIds(s).length === 2 && L.comboIds(s).every((id) => L.seafoodOf(ds.find((d) => d.id === id)) !== 'main'), 'cold-day combo without seafood');
  }
});

test('where to buy: every ingredient has a store; 不用跑亚洲超市 filter', () => {
  for (const d of [...DISHES, ...EXTRAS]) for (const i of d.ings) assert.ok(whereToBuy(i), 'no store for ' + i);
  for (const p of PANTRY) assert.ok(whereToBuy(p), 'no store for ' + p);
  assert.equal(storeOf('鸡蛋'), 'any');
  assert.equal(storeOf('腊肠'), 'asian');
  assert.equal(storeOf('豆腐'), 'cw');
  assert.ok(whereToBuy('豆腐').cheaper && whereToBuy('豆腐').en.includes('tofu'));
  assert.equal(storeOf('2个番茄'), 'any', 'amounts typed in still match');
  assert.equal(storeOf('面包'), 'other');
  assert.ok(STORES.any && STORES.cw && STORES.asian && STORES.other);
  assert.deepEqual(L.asianIngs(ds.find((d) => d.id === 'veg-rice')), ['腊肠']);
  const f = { ...L.DEFAULT_FILTER, easyShop: true };
  const ok = ds.filter((d) => L.matchesFilter(d, f));
  assert.ok(ok.length >= 40 && ok.every((d) => !L.asianIngs(d).length));
  assert.ok(!ok.some((d) => d.id === 'veg-rice') && ok.some((d) => d.id === 'tomato-egg'));
});

test('suggested new dishes: pending until added; a few each week, stable within the week', () => {
  const recs = [{ id: EXTRAS[0].id, added: true }, { id: EXTRAS[1].id, fav: true }];
  const all = L.mergeDishes(DISHES, recs, EXTRAS);
  assert.equal(all.length, DISHES.length + 1);
  assert.ok(all.find((d) => d.id === EXTRAS[0].id).builtin);
  const pend = L.pendingExtras(EXTRAS, recs);
  assert.equal(pend.length, EXTRAS.length - 1);
  assert.ok(pend.every((d) => d.pending) && pend.find((d) => d.id === EXTRAS[1].id).fav);
  const w1 = L.weeklyNew(pend, { week: '2026-11-16', n: 3 });
  assert.equal(w1.length, 3); assert.equal(new Set(w1).size, 3);
  assert.deepEqual(L.weeklyNew(pend, { week: '2026-11-16', n: 3 }), w1, 'same week → same suggestions');
  assert.notDeepEqual(L.weeklyNew(pend, { week: '2026-11-23', n: 3 }), w1, 'next week → new ones');
  assert.ok(!L.weeklyNew(pend, { week: '2026-11-16', n: 3, dismissed: [w1[0]] }).includes(w1[0]), 'dismissed are not suggested');
});

test('learns the taste from the records; analysis of recent cooking', () => {
  const logs = [
    { id: '1', dishId: 'tomato-egg', date: T, rating: 5 }, { id: '2', dishId: 'tomato-egg', date: L.addDays(T, -3), rating: 5 },
    { id: '3', dishId: 'tomato-egg-soup', date: L.addDays(T, -5), rating: 4 }, { id: '4', dishId: 'bittergourd-egg', date: L.addDays(T, -6), rating: 1 },
    { id: '5', dishId: 'bittergourd-egg', date: L.addDays(T, -50), rating: 1 }, { id: '6', dishId: 'steak', date: L.addDays(T, -60), rating: 5 },
  ];
  const p = L.learnPrefs(logs, ds);
  assert.equal(p.n, 6);
  assert.ok(p.groups['番茄'] > 0.3, 'likes tomato');
  assert.ok(p.groups['瓜类'] < -0.3, 'not bitter gourd');
  const byId = (id) => ds.find((d) => d.id === id);
  assert.ok(L.prefBoost(byId('tomato-tofu'), p) > 1.15, 'tomato dishes get a boost');
  assert.ok(L.prefBoost(byId('luffa-egg-soup'), p) < 1, 'gourd dishes less');
  assert.equal(L.prefBoost(byId('tomato-tofu'), null), 1);
  const s = L.tasteSummary(p);
  assert.ok(s.liked.includes('番茄') && s.disliked.includes('瓜类'));
  const a = L.analyze(logs, ds, L.addDays(T, -29));
  assert.equal(a.n, 4); assert.equal(a.distinct, 3);
  assert.deepEqual(a.dishes[0], { k: 'tomato-egg', count: 2 });
  assert.equal(a.ings[0].k, '鸡蛋'); assert.equal(a.ings[0].count, 4);
  assert.equal(a.avg, 15 / 4);
  assert.equal(a.taste.light, 3);
  assert.equal(L.analyze(logs, ds, null).n, 6);
  const miss = L.missYou(L.dishStats(logs), T);
  assert.deepEqual(miss.map((x) => x.id), ['steak'], 'well rated, not cooked for 60 days');
});

test('weather: dinner-time temperatures from the forecast; cold days get 荤素一锅 + 汤', () => {
  const time = [];
  const temperature_2m = [];
  for (const [d, base] of [['2026-11-19', 20], ['2026-11-20', 11]]) for (let h = 0; h < 24; h++) { time.push(`${d}T${String(h).padStart(2, '0')}:00`); temperature_2m.push(h >= 18 && h <= 20 ? base + (h - 19) : 99); }
  const days = L.eveningTemps({ hourly: { time, temperature_2m } });
  assert.deepEqual(days, { '2026-11-19': 20, '2026-11-20': 11 });
  assert.deepEqual(L.eveningTemps({}), {});
  assert.ok(!L.isCold(20) && L.isCold(11) && L.isCold(L.COLD_AT) && !L.isCold(undefined));
  assert.ok(L.weatherUrl(L.CITIES.mel).includes('latitude=-37.81'));
  const dates = L.weekDates(L.weekStart(T));
  const add = L.fillWeek(ds, {}, dates, { ...base, rng: L.seeded(12), perDay: 2, filter: L.DEFAULT_FILTER, coldOn: (d) => L.isCold(days[d]) });
  assert.deepEqual(Object.keys(add), ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.ok(Object.values(add).every((ids) => ids.length === 2), 'two dishes a day');
  const warm = add['2026-11-19'].map((id) => ds.find((d) => d.id === id).type);
  assert.deepEqual(warm, ['meat', 'veg']);
  const cold = add['2026-11-20'].map((id) => ds.find((d) => d.id === id));
  assert.ok(L.isMixed(cold[0]) && cold[1].type === 'soup', 'cold evening → 荤素一锅 + 汤');
  const flat = Object.values(add).flat();
  assert.equal(new Set(flat).size, flat.length, 'no repeats in the week');
});

test('fridge: ingredient groups and matches', () => {
  assert.equal(L.groupOf('鸡腿'), '鸡肉');
  assert.equal(L.groupOf('鸡蛋'), '鸡蛋');
  assert.equal(L.groupOf('五花肉'), '猪肉');
  assert.equal(L.groupOf('新鲜番茄 2个'), '番茄', 'typed amounts still match');
  assert.equal(L.groupOf('可乐'), null);
  for (const [g, , list] of FRIDGE) for (const x of list) assert.equal(L.groupOf(x), g, x);
  const ms = L.fridgeMatches(ds, ['鸡蛋', '番茄'], {});
  assert.equal(ms[0].hit.length, 2);
  assert.ok(['tomato-egg', 'tomato-egg-soup'].includes(ms[0].dish.id), 'tomato + egg dishes come first: ' + ms[0].dish.id);
  assert.deepEqual(ms.find((m) => m.dish.id === 'tomato-egg').missing, [], '葱 is a seasoning, not missing');
  assert.ok(ms.every((m) => m.hit.length >= 1));
  const steamed = ms.find((m) => m.dish.id === 'steamed-egg');
  assert.ok(steamed && steamed.missing.length === 0);
  const rng = L.seeded(5);
  for (let i = 0; i < 50; i++) { const d = L.pickFridge(ms, { ...base, rng }); assert.ok(ms.slice(0, 12).some((m) => m.dish.id === d.id)); }
  assert.equal(L.pickFridge(ms, { ...base, skip: ms.map((m) => m.dish.id) }), null);
  assert.equal(L.fridgeMatches(ds, ['鸡蛋'], { filter: { cuisine: 'jk' } }).every((m) => m.dish.cuisine === 'jk'), true);
});

test('fill a week: only empty days from today on, no repeats', () => {
  const dates = L.weekDates(L.weekStart(T));
  assert.equal(dates.length, 7); assert.equal(dates[0], '2026-11-16'); assert.equal(dates[6], '2026-11-22');
  const plan = { '2026-11-20': ['steak'] };
  const add = L.fillWeek(ds, plan, dates, { ...base, rng: L.seeded(6) });
  assert.deepEqual(Object.keys(add).sort(), ['2026-11-19', '2026-11-21', '2026-11-22']);
  const all = [...Object.values(add).flat(), 'steak'];
  assert.equal(new Set(all).size, all.length);
});

test('shopping list: merge by name, seasonings optional, no duplicates', () => {
  const pick = (...ids) => ids.map((id) => ds.find((d) => d.id === id));
  const items = L.shoppingFrom(pick('tomato-egg', 'tomato-egg-soup', 'garlic-greens'), false);
  assert.deepEqual(items.map((x) => x.name), ['番茄', '鸡蛋', '青菜']);
  assert.deepEqual(items[0].for, ['番茄炒蛋', '番茄蛋花汤']);
  assert.ok(L.shoppingFrom(pick('garlic-greens'), true).some((x) => x.name === '蒜'));
  let k = 0;
  const id = () => 'i' + ++k;
  const r1 = L.mergeShop([{ id: 'old', name: '鸡蛋', for: ['蒸水蛋'], done: false }, { id: 'b', name: '番茄', for: [], done: true }], items, id);
  assert.equal(r1.added, 2, '鸡蛋 already on the list; 番茄 was bought so it is added again');
  assert.deepEqual(r1.list.find((x) => x.id === 'old').for, ['蒸水蛋', '番茄炒蛋', '番茄蛋花汤']);
  assert.ok(PANTRY.includes('酱油'));
});

test('reads links out of shared text', () => {
  const a = L.parseShared('62 【番茄炒蛋这样做太香了 - 小厨娘 | 小红书 - 你的生活指南】 😆 AbCdEf123 😆 https://www.xiaohongshu.com/discovery/item/66aa11bb?source=webshare&xsec_token=XYZ');
  assert.equal(a.src, 'xhs'); assert.equal(a.title, '番茄炒蛋这样做太香了');
  assert.ok(a.url.startsWith('https://www.xiaohongshu.com/discovery/item/66aa11bb'));
  const b = L.parseShared('超下饭的可乐鸡翅 http://xhslink.com/a/AbCd123，复制本条信息，打开【小红书】App查看精彩内容！');
  assert.equal(b.url, 'http://xhslink.com/a/AbCd123'); assert.equal(b.title, '超下饭的可乐鸡翅'); assert.equal(b.src, 'xhs');
  assert.equal(L.parseShared('https://youtu.be/abc').src, 'yt');
  assert.equal(L.parseShared('没有链接'), null);
  assert.equal(L.parseShared(''), null);
  assert.ok(L.xhsApp('番茄炒蛋 做法').startsWith('xhsdiscover://search/result?keyword=%E7%95%AA'));
  assert.equal(L.searchQ({ name: '可乐鸡翅' }), '可乐鸡翅 做法');
  assert.equal(L.stars(3.6), '★★★★☆');
});

test('filters count only what differs from the everyday default', () => {
  assert.equal(L.activeFilters(L.DEFAULT_FILTER), 0);
  assert.equal(L.activeFilters({}), 0);
  assert.equal(L.activeFilters({ ...L.DEFAULT_FILTER, level: 0 }), 1);
  assert.equal(L.activeFilters({ cuisine: 'my', type: 'soup', taste: 'heavy', maxTime: 30, level: 2, favOnly: true }), 5, 'taste is not counted');
});

test('口味: every dish is tagged; everyday default = light, beginner-friendly home cooking', () => {
  const ids = new Set(DISHES.map((d) => d.id));
  for (const set of Object.values(TASTE_IDS)) for (const id of set) assert.ok(ids.has(id), 'unknown id in taste list: ' + id);
  for (const d of DISHES) assert.ok(TASTES[d.taste], d.id);
  for (const id of ['tomato-egg', 'steamed-egg', 'garlic-greens', 'corn-rib-soup', 'shrimp-egg']) assert.equal(DISHES.find((d) => d.id === id).taste, 'light', id);
  for (const id of ['kr-fried-chicken', 'tonkatsu', 'mapo-tofu', 'hongshao-rou', 'nasi-lemak']) assert.equal(DISHES.find((d) => d.id === id).taste, 'heavy', id);
  const daily = ds.filter((d) => L.matchesFilter(d, L.DEFAULT_FILTER));
  assert.ok(daily.every((d) => d.taste !== 'heavy' && d.level === 1));
  for (const t of KINDS) {
    assert.ok(daily.filter((d) => d.type === t).length >= 10, 'enough everyday ' + t);
    assert.ok(daily.filter((d) => d.type === t && d.taste === 'light').length >= 6, 'enough light ' + t);
  }
  const rng = L.seeded(9);
  const light = { ...L.DEFAULT_FILTER, taste: 'light' };
  const heavy = { ...L.DEFAULT_FILTER, taste: 'heavy' };
  for (let i = 0; i < 100; i++) {
    assert.equal(L.pickOne(ds, { ...base, rng, filter: light }).dish.taste, 'light');
    assert.equal(L.pickOne(ds, { ...base, rng, filter: heavy }).dish.taste, 'heavy');
    const lc = L.pickCombo(ds, { ...base, rng, filter: light });
    assert.ok(L.comboIds(lc).length === 2 && L.comboIds(lc).every((id) => ds.find((d) => d.id === id).taste === 'light'), '少油少盐 两道菜');
    const hc = L.pickCombo(ds, { ...base, rng, filter: heavy });
    assert.equal(ds.find((d) => d.id === hc.slots.meat).taste, 'heavy', 'heavy combo: the meat dish is the treat');
    assert.ok(hc.slots.veg && ds.find((d) => d.id === hc.slots.veg).taste !== 'heavy', 'the vegetable stays everyday');
    const hs = L.pickCombo(ds, { ...base, rng, combo: 'soup', filter: heavy });
    assert.ok(hs.slots.soup && ds.find((d) => d.id === hs.slots.soup).taste !== 'heavy', 'so does the soup');
  }
  // light dishes come up more often than normal ones
  const pair = ds.filter((d) => d.id === 'tomato-egg' || d.id === 'potato-shreds');
  let te = 0;
  for (let i = 0; i < 4000; i++) if (L.pickOne(pair, { ...base, rng }).dish.id === 'tomato-egg') te++;
  assert.ok(te > 2100 && te < 2500, 'light ≈ 1.3:1, got ' + te);
});

console.log(`\nAll ${n} logic tests passed.`);
