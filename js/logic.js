// Pure logic (no DOM): dates, picking dishes, fridge matching, week plans, shopping lists, stats, weather, taste learning.
// Tested by test/logic.test.js.
import { FRIDGE, PANTRY, GARLIC_MUST } from './dishes.js';
import { storeOf } from './shops.js';

// ---------- dates (local 'YYYY-MM-DD' strings) ----------
const pad = (n) => String(n).padStart(2, '0');
export function today(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return today(d); }
/** Whole days from a to b (b later → positive). */
export function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
/** Monday of the week that contains s. */
export function weekStart(s) { const d = parseDate(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return today(d); }
const WD = ['日', '一', '二', '三', '四', '五', '六'];
export const weekday = (s) => '周' + WD[parseDate(s).getDay()];
export function fmtDate(s, withWeek = true) { const d = parseDate(s); return `${d.getMonth() + 1}月${d.getDate()}日${withWeek ? ' ' + weekday(s) : ''}`; }
export function relDays(s, t) {
  const n = diffDays(s, t);
  if (n === 0) return '今天';
  if (n === 1) return '昨天';
  if (n === -1) return '明天';
  if (n < 0) return `${-n} 天后`;
  if (n < 7) return `${n} 天前`;
  if (n < 30) return `${Math.floor(n / 7)} 周前`;
  if (n < 365) return `${Math.floor(n / 30)} 个月前`;
  return `${Math.floor(n / 365)} 年前`;
}
export function greeting(h) { return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; }
/** Days of a month laid out Monday-first: leading nulls, then 'YYYY-MM-DD' strings. */
export function monthGrid(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const n = new Date(y, m, 0).getDate();
  const out = Array((first.getDay() + 6) % 7).fill(null);
  for (let d = 1; d <= n; d++) out.push(`${y}-${pad(m)}-${pad(d)}`);
  return out;
}
export function addMonths(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

// ---------- dishes ----------
const DISH_DEFAULTS = { fav: false, hidden: false, links: [], ings: [], time: 30, level: 1, emoji: '🍽️', cuisine: 'cn', type: 'meat', taste: 'normal' };
const clean = (recs) => recs.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null)));
/**
 * Built-in dishes + the user's records (favourite / hidden / links / edits / photo, and their own dishes).
 * Suggested new dishes (extras) join the library once the user added them (rec.added).
 */
export function mergeDishes(builtins, recs, extras) {
  recs = clean(recs);
  const by = new Map(recs.map((r) => [r.id, r]));
  const out = builtins.map((b) => ({ ...b, ...(by.get(b.id) || {}), builtin: true }));
  for (const e of extras || []) { const r = by.get(e.id); if (r && r.added) out.push({ ...e, ...r, builtin: true }); }
  for (const r of recs) if (r.custom) out.push({ ...r, builtin: false });
  return out.map((d) => ({ ...DISH_DEFAULTS, ...d }));
}
/** Suggested dishes the user has not added yet (they can still be opened and previewed). */
export function pendingExtras(extras, recs) {
  const by = new Map(clean(recs).map((r) => [r.id, r]));
  return extras.filter((e) => !(by.get(e.id) || {}).added).map((e) => ({ ...DISH_DEFAULTS, ...e, ...(by.get(e.id) || {}), builtin: true, pending: true }));
}

/** Splits typed ingredients: spaces, commas, 、 and new lines all work. */
export function splitIngs(text) { return [...new Set(String(text || '').split(/[\s,，、;；/]+/).map((x) => x.trim()).filter(Boolean))]; }

export const isPantry = (ing) => PANTRY.includes(ing);

/** Per dish: times cooked, last date, average stars, latest note, latest photo. */
export function dishStats(logs) {
  const m = {};
  const sorted = [...logs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  for (const l of sorted) {
    const s = m[l.dishId] || (m[l.dishId] = { count: 0, last: null, sum: 0, rated: 0, avg: 0, lastNote: null, photo: null });
    s.count++;
    s.last = l.date;
    if (l.rating) { s.sum += l.rating; s.rated++; }
    if (l.note && l.note.trim()) s.lastNote = { text: l.note.trim(), date: l.date, rating: l.rating || 0, logId: l.id };
    if (l.photo) s.photo = l.photo;
  }
  for (const s of Object.values(m)) s.avg = s.rated ? s.sum / s.rated : 0;
  return m;
}

// ---------- what a dish needs ----------
/** 'must' = garlic is the point (蒜蓉…), 'opt' = uses some garlic but fine without, 'none'. */
export function garlicOf(d) {
  if (GARLIC_MUST.has(d.id) || /蒜/.test(d.name || '')) return 'must';
  return (d.ings || []).some((i) => i.includes('蒜')) ? 'opt' : 'none';
}
/** Ingredients only an Asian grocer sells (seasonings the kitchen already has don't count). */
export const asianIngs = (d) => (d.ings || []).filter((i) => !isPantry(i) && storeOf(i) === 'asian');

const MEAT_GROUPS = ['鸡肉', '猪肉', '牛肉', '虾', '鱼'];
const MORE_MEAT = ['鸭', '啦啦'];
const VEG_GROUPS = ['番茄', '土豆', '青菜', '茄子', '西兰花', '胡萝卜', '菇类', '青椒', '瓜类', '豆芽', '黄瓜', '玉米'];
const MORE_VEG = ['木耳', '芹菜', '荷兰豆', '四季豆', '秋葵', '莲藕', '萝卜', '菠萝', '青豆'];
export const hasMeat = (d) => (d.ings || []).some((i) => MEAT_GROUPS.includes(groupOf(i)) || MORE_MEAT.some((x) => i.includes(x)));
export const hasVeg = (d) => (d.ings || []).some((i) => !isPantry(i) && (VEG_GROUPS.includes(groupOf(i)) || MORE_VEG.some((x) => i.includes(x))));
/** 有肉有菜: a meat dish or a rice / noodle dish with both meat and vegetables in it. */
export const isMixed = (d) => (d.type === 'meat' || d.type === 'main') && hasMeat(d) && hasVeg(d);

// Everyday default: no fried / strong-flavoured dishes, beginner-friendly only.
export const DEFAULT_FILTER = { cuisine: 'all', type: 'all', taste: 'daily', maxTime: 0, level: 1, favOnly: false, noGarlic: false, easyShop: false };
export const TASTE_FILTERS = { daily: '日常', light: '少油少盐', heavy: '油炸重口', all: '口味不限' };

export function matchesTaste(d, taste) {
  const t = d.taste || 'normal';
  if (taste === 'daily') return t !== 'heavy';
  if (taste === 'light' || taste === 'heavy') return t === taste;
  return true;
}

export function matchesFilter(d, f) {
  f = f || {};
  if (f.taste && !matchesTaste(d, f.taste)) return false;
  if (f.cuisine && f.cuisine !== 'all' && d.cuisine !== f.cuisine) return false;
  if (f.type === 'mixed') { if (!isMixed(d)) return false; } else if (f.type && f.type !== 'all' && d.type !== f.type) return false;
  if (f.maxTime && d.time > f.maxTime) return false;
  if (f.level && d.level > f.level) return false;
  if (f.favOnly && !d.fav) return false;
  if (f.noGarlic && garlicOf(d) === 'must') return false;
  if (f.easyShop && asianIngs(d).length) return false;
  return true;
}
/** How many filters differ from the everyday default (口味 has its own row on the home screen, so it is not counted). */
export function activeFilters(f) {
  f = { ...DEFAULT_FILTER, ...(f || {}) };
  return Object.keys(DEFAULT_FILTER).filter((k) => k !== 'taste' && f[k] !== DEFAULT_FILTER[k]).length;
}

/**
 * How likely a dish is to be picked: favourites, light and well-rated dishes more, badly rated less, a nudge for new ones.
 * o.prefs (learned from the records) nudges dishes like the ones the user rated well; soup comes up rarely unless o.cold.
 */
export function weightOf(d, st, t, o) {
  let w = 1;
  if (o && o.prefs) w *= prefBoost(d, o.prefs);
  if (d.type === 'soup') w *= o && o.cold ? 1.5 : 0.4; // the user seldom makes soup, except when it is cold
  if (d.fav) w *= 3;
  if (d.taste === 'light') w *= 1.3; // the user eats light: light dishes come up a bit more often
  if (st && st.rated) { if (st.avg >= 4) w *= 1.6; else if (st.avg <= 2) w *= 0.35; }
  if (!st) w *= 1.15;
  if (st && st.last && diffDays(st.last, t) > 30) w *= 1.3;
  return w;
}

function weighted(list, wf, rng) {
  const ws = list.map(wf);
  let r = rng() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r < 0) return list[i]; }
  return list[list.length - 1];
}

/**
 * Picks one dish. o: { filter, stats, today, avoidDays, skip: ids, rng }.
 * Dishes cooked in the last `avoidDays` days are left out — unless that leaves nothing (then relaxed: true).
 */
export function pickOne(dishes, o) {
  const skip = new Set(o.skip || []);
  const stats = o.stats || {};
  const base = dishes.filter((d) => !d.hidden && !skip.has(d.id) && matchesFilter(d, o.filter));
  const fresh = base.filter((d) => { const s = stats[d.id]; return !(s && s.last && o.avoidDays > 0 && diffDays(s.last, o.today) < o.avoidDays); });
  const pool = fresh.length ? fresh : base;
  if (!pool.length) return null;
  return { dish: weighted(pool, (d) => weightOf(d, stats[d.id], o.today, o), o.rng || Math.random), relaxed: !fresh.length, poolSize: pool.length };
}

// 两道菜: usually 一荤一素; on cold days one dish with meat and vegetables + a soup.
export const SLOTS = { meat: { name: '荤菜', emoji: '🍖' }, veg: { name: '素菜', emoji: '🥬' }, mixed: { name: '有肉有菜', emoji: '🍛' }, soup: { name: '汤', emoji: '🥣' } };
export const COMBOS = { mv: { name: '一荤一素', emoji: '🍖🥬', slots: ['meat', 'veg'] }, soup: { name: '荤素一锅 + 汤', emoji: '🍛🥣', slots: ['mixed', 'soup'] } };
/** Slot filter: the type filter is replaced by the slot; with 油炸重口 only the meat dish is the treat. */
export function slotFilter(f, slot) {
  f = f || {};
  return { ...f, type: slot, taste: f.taste === 'heavy' && (slot === 'veg' || slot === 'soup') ? 'daily' : f.taste };
}
/** o.combo: 'mv' (一荤一素, default) or 'soup'. Returns { kind, slots: { slot: id | null } }. */
export function pickCombo(dishes, o) {
  const kind = COMBOS[o.combo] ? o.combo : 'mv';
  const out = { kind, slots: {} };
  const skip = [...(o.skip || [])];
  for (const slot of COMBOS[kind].slots) {
    const r = pickOne(dishes, { ...o, skip, filter: slotFilter(o.filter, slot) });
    out.slots[slot] = r ? r.dish.id : null;
    if (r) skip.push(r.dish.id);
  }
  return out;
}
export const comboIds = (c) => (c ? Object.values(c.slots).filter(Boolean) : []);

// ---------- fridge ----------
/** Which fridge group an ingredient belongs to ('鸡腿' → '鸡肉'), or null. */
export function groupOf(ing) {
  for (const [g, , list] of FRIDGE) if (list.includes(ing)) return g;
  for (const [g, , list] of FRIDGE) if (ing.includes(g) || list.some((x) => x.length >= 2 && ing.includes(x))) return g;
  return null;
}

/** Dishes that use what the user has, best first: { dish, hit: groups used, missing: ingredients to buy }. */
export function fridgeMatches(dishes, have, o) {
  const H = new Set(have);
  const out = [];
  for (const d of dishes) {
    if (d.hidden || !matchesFilter(d, (o && o.filter) || {})) continue;
    const hit = new Set();
    const missing = [];
    for (const ing of d.ings) {
      if (isPantry(ing)) continue; // 番茄酱 is not a tomato
      const g = groupOf(ing);
      if (g && H.has(g)) hit.add(g);
      else missing.push(ing);
    }
    if (hit.size) out.push({ dish: d, hit: [...hit], missing, score: hit.size * 10 - missing.length });
  }
  return out.sort((a, b) => b.score - a.score || a.dish.time - b.dish.time);
}

/** A weighted random pick among the best few fridge matches. */
export function pickFridge(matches, o) {
  const skip = new Set(o.skip || []);
  const list = matches.filter((m) => !skip.has(m.dish.id));
  if (!list.length) return null;
  const top = list.filter((m) => m.score >= list[0].score - 2).slice(0, 8);
  return weighted(top, (m) => weightOf(m.dish, (o.stats || {})[m.dish.id], o.today, { ...o, cold: true }), o.rng || Math.random).dish;
}

// ---------- week plan & shopping ----------
export function weekDates(start) { return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }

/**
 * Fills the empty days (today or later) of a week, no repeats within the week. Returns { date: [ids] }.
 * o.perDay 2 → 两道菜 each day (o.coldOn(date) → that day gets 荤素一锅 + 汤); otherwise one dish.
 */
export function fillWeek(dishes, plan, dates, o) {
  const used = dates.flatMap((d) => plan[d] || []);
  const out = {};
  for (const d of dates) {
    if (d < o.today || (plan[d] && plan[d].length)) continue;
    const cold = !!(o.coldOn && o.coldOn(d));
    let ids;
    if (o.perDay === 2) ids = comboIds(pickCombo(dishes, { ...o, skip: used, cold, combo: cold ? 'soup' : 'mv' }));
    else { const r = pickOne(dishes, { ...o, skip: used, cold, filter: { ...(o.filter || {}), type: 'all' } }); ids = r ? [r.dish.id] : []; }
    if (!ids.length) break;
    out[d] = ids;
    used.push(...ids);
  }
  return out;
}

/** Ingredients for these dishes, merged by name. Seasonings are left out unless withPantry. */
export function shoppingFrom(dishes, withPantry) {
  const m = new Map();
  for (const d of dishes) for (const ing of d.ings) {
    if (!withPantry && isPantry(ing)) continue;
    const it = m.get(ing) || { name: ing, for: [] };
    if (!it.for.includes(d.name)) it.for.push(d.name);
    m.set(ing, it);
  }
  return [...m.values()];
}

/** Adds items to a shopping list: an unbought item with the same name just gets the new dish names. */
export function mergeShop(list, items, newId) {
  const out = list.map((x) => ({ ...x, for: [...(x.for || [])] }));
  let added = 0;
  for (const it of items) {
    const same = out.find((x) => !x.done && x.name === it.name);
    if (same) { for (const f of it.for || []) if (!same.for.includes(f)) same.for.push(f); continue; }
    out.push({ id: newId(), name: it.name, for: [...(it.for || [])], done: false, createdAt: Date.now() + added });
    added++;
  }
  return { list: out, added };
}

// ---------- records ----------
/** Days in a row with at least one cooked dish, ending today (or yesterday if nothing yet today). */
export function streak(logs, t) {
  const days = new Set(logs.map((l) => l.date));
  let d = days.has(t) ? t : addDays(t, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
export function topDishes(stats, n) {
  return Object.entries(stats).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.count - a.count || (b.last > a.last ? 1 : -1)).slice(0, n);
}

// ---------- learning the user's taste ----------
const tally = (o, k, v) => { o[k] = (o[k] || 0) + v; };
/**
 * From the records: how much the user likes each ingredient group and cuisine, -1 … 1.
 * A rating counts (5★ +1, 3★ 0, 1★ -1); cooked without a rating counts a little (+0.25).
 */
export function learnPrefs(logs, dishes) {
  const by = new Map(dishes.map((d) => [d.id, d]));
  const groups = {};
  const cuisines = {};
  let n = 0;
  for (const l of logs) {
    const d = by.get(l.dishId);
    if (!d) continue;
    n++;
    const v = l.rating ? (l.rating - 3) / 2 : 0.25;
    for (const g of new Set(d.ings.map(groupOf).filter(Boolean))) tally(groups, g, v);
    tally(cuisines, d.cuisine, v);
  }
  const norm = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.tanh(v / 3)]));
  return { n, groups: norm(groups), cuisines: norm(cuisines) };
}
/** 0.6 … 1.6: how much more often a dish should come up given the learned taste. */
export function prefBoost(d, p) {
  if (!p || !p.n) return 1;
  const gs = [...new Set((d.ings || []).map(groupOf).filter(Boolean))];
  const ga = gs.length ? gs.reduce((s, g) => s + (p.groups[g] || 0), 0) / gs.length : 0;
  return Math.min(1.6, Math.max(0.6, 1 + 0.45 * ga + 0.2 * (p.cuisines[d.cuisine] || 0)));
}
/** What the app has learned, for showing: liked and not-so-liked ingredient groups. */
export function tasteSummary(p) {
  const e = Object.entries((p && p.groups) || {});
  return {
    liked: e.filter(([, v]) => v >= 0.15).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k),
    disliked: e.filter(([, v]) => v <= -0.15).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([k]) => k),
  };
}

/** Records since `from` (or all): counts, most-cooked dishes, most-used ingredients, 口味 and 菜系 mix, average stars. */
export function analyze(logs, dishes, from) {
  const by = new Map(dishes.map((d) => [d.id, d]));
  const ls = logs.filter((l) => !from || l.date >= from);
  const dishN = {};
  const ingN = {};
  const cuisine = {};
  const taste = { light: 0, normal: 0, heavy: 0 };
  let sum = 0;
  let rated = 0;
  for (const l of ls) {
    tally(dishN, l.dishId, 1);
    if (l.rating) { sum += l.rating; rated++; }
    const d = by.get(l.dishId);
    if (!d) continue;
    taste[d.taste || 'normal']++;
    tally(cuisine, d.cuisine, 1);
    for (const k of new Set(d.ings.filter((i) => !isPantry(i)).map((i) => groupOf(i) || i))) tally(ingN, k, 1);
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, count]) => ({ k, count }));
  return { n: ls.length, distinct: Object.keys(dishN).length, avg: rated ? sum / rated : 0, dishes: top(dishN, 5), ings: top(ingN, 8), cuisines: top(cuisine, 5), taste };
}
/** Well-rated dishes that haven't been cooked for `days` days. */
export function missYou(stats, t, days = 30) {
  return Object.entries(stats).filter(([, s]) => s.avg >= 4 && s.last && diffDays(s.last, t) >= days)
    .sort((a, b) => b[1].avg - a[1].avg || (a[1].last < b[1].last ? -1 : 1)).slice(0, 3).map(([id, s]) => ({ id, ...s }));
}

/** This week's suggested new dishes: n extras the user hasn't added or dismissed, leaning to their taste; stable within a week. */
export function weeklyNew(pending, o) {
  const rng = seeded(Number(String(o.week).replace(/\D/g, '')) || 1);
  const no = new Set(o.dismissed || []);
  const list = pending.filter((d) => !no.has(d.id));
  const out = [];
  while (out.length < (o.n || 3) && list.length) {
    const d = weighted(list, (x) => prefBoost(x, o.prefs) * (x.taste === 'light' ? 1.2 : 1), rng);
    out.push(d.id);
    list.splice(list.indexOf(d), 1);
  }
  return out;
}

// ---------- weather (Open-Meteo, free, no key) ----------
export const CITIES = {
  syd: ['悉尼 Sydney', -33.87, 151.21], mel: ['墨尔本 Melbourne', -37.81, 144.96], bne: ['布里斯班 Brisbane', -27.47, 153.03],
  per: ['珀斯 Perth', -31.95, 115.86], adl: ['阿德莱德 Adelaide', -34.93, 138.6], cbr: ['堪培拉 Canberra', -35.28, 149.13],
  hba: ['霍巴特 Hobart', -42.88, 147.33], ool: ['黄金海岸 Gold Coast', -28.02, 153.4], drw: ['达尔文 Darwin', -12.46, 130.84],
};
export const COLD_AT = 15; // °C at dinner time (6–8 pm) or lower → 天冷，来个汤
export const isCold = (temp) => typeof temp === 'number' && temp <= COLD_AT;
export const weatherUrl = (c) => `https://api.open-meteo.com/v1/forecast?latitude=${c[1]}&longitude=${c[2]}&hourly=temperature_2m&timezone=auto&forecast_days=7`;
/** Open-Meteo hourly forecast → { 'YYYY-MM-DD': average °C from 6 to 8 pm }. */
export function eveningTemps(json) {
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.temperature_2m)) return {};
  const acc = {};
  h.time.forEach((t, i) => {
    const hr = Number(String(t).slice(11, 13));
    const v = h.temperature_2m[i];
    if (hr >= 18 && hr <= 20 && typeof v === 'number') (acc[t.slice(0, 10)] = acc[t.slice(0, 10)] || []).push(v);
  });
  return Object.fromEntries(Object.entries(acc).map(([d, v]) => [d, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]));
}

// ---------- links ----------
export const searchQ = (d) => `${d.name} 做法`;
export const xhsApp = (q) => `xhsdiscover://search/result?keyword=${encodeURIComponent(q)}`;
export const xhsWeb = (q) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}&source=web_search_result_notes`;
export const xcfWeb = (q) => `https://www.xiachufang.com/search/?keyword=${encodeURIComponent(q.replace(/\s*做法$/, ''))}`;
export const ytWeb = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q.replace(/\s*做法$/, ' recipe'))}`;

/** Reads a link out of text shared from 小红书 (or anywhere): { url, title, src }. */
export function parseShared(text) {
  const t = String(text || '').trim();
  const m = t.match(/https?:\/\/[^\s，。！!）)】"'<>]+/i);
  if (!m) return null;
  const url = m[0].replace(/[，,。.]+$/, '');
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { return null; }
  const before = t.slice(0, m.index);
  const br = before.match(/【([^】]+)】/);
  let title = br ? br[1].replace(/\s*[|｜]\s*小红书.*$/, '').replace(/\s+-\s+[^-]*$/, '') : before; // 【标题 - 作者 | 小红书 - …】
  title = title
    .replace(/😆\s*\w+\s*😆/g, '')
    .replace(/^\s*\d+\s*/, '')
    .replace(/(发布了一篇小红书笔记[，,]?快来看吧[！!]?)/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const src = /xhslink|xiaohongshu|rednote/.test(host) ? 'xhs' : /youtu/.test(host) ? 'yt' : /xiachufang/.test(host) ? 'xcf' : 'web';
  return { url, title: title.slice(0, 60), src };
}

export function stars(n) { n = Math.round(n || 0); return '★'.repeat(n) + '☆'.repeat(5 - n); }

/** Small seeded random generator (tests). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
