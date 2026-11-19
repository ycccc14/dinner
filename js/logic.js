// Pure logic (no DOM): dates, picking dishes, fridge matching, week plans, shopping lists, stats.
// Tested by test/logic.test.js.
import { FRIDGE, PANTRY } from './dishes.js';

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
/** Built-in dishes + the user's records (favourite / hidden / links / edits, and their own dishes). */
export function mergeDishes(builtins, recs) {
  recs = recs.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null)));
  const by = new Map(recs.map((r) => [r.id, r]));
  const out = builtins.map((b) => ({ ...b, ...(by.get(b.id) || {}), builtin: true }));
  for (const r of recs) if (r.custom) out.push({ ...r, builtin: false });
  return out.map((d) => ({ fav: false, hidden: false, links: [], ings: [], time: 30, level: 1, emoji: '🍽️', cuisine: 'cn', type: 'meat', taste: 'normal', ...d }));
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

// Everyday default: no fried / strong-flavoured dishes, beginner-friendly only.
export const DEFAULT_FILTER = { cuisine: 'all', type: 'all', taste: 'daily', maxTime: 0, level: 1, favOnly: false };
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
  if (f.type && f.type !== 'all' && d.type !== f.type) return false;
  if (f.maxTime && d.time > f.maxTime) return false;
  if (f.level && d.level > f.level) return false;
  if (f.favOnly && !d.fav) return false;
  return true;
}
/** How many filters differ from the everyday default (口味 has its own row on the home screen, so it is not counted). */
export function activeFilters(f) {
  f = { ...DEFAULT_FILTER, ...(f || {}) };
  return Object.keys(DEFAULT_FILTER).filter((k) => k !== 'taste' && f[k] !== DEFAULT_FILTER[k]).length;
}

/** How likely a dish is to be picked: favourites, light and well-rated dishes more, badly rated less, a nudge for new ones. */
export function weightOf(d, st, t) {
  let w = 1;
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
  return { dish: weighted(pool, (d) => weightOf(d, stats[d.id], o.today), o.rng || Math.random), relaxed: !fresh.length, poolSize: pool.length };
}

export const COMBO = ['meat', 'veg', 'soup'];
/**
 * 两菜一汤: one meat dish, one vegetable dish and one soup (the type filter is ignored).
 * With 油炸重口 only the meat dish is fried / strong; the vegetable and the soup stay everyday food.
 */
export function pickCombo(dishes, o) {
  const out = {};
  const skip = [...(o.skip || [])];
  const f = o.filter || {};
  for (const type of COMBO) {
    const taste = f.taste === 'heavy' && type !== 'meat' ? 'daily' : f.taste;
    const r = pickOne(dishes, { ...o, skip, filter: { ...f, type, taste } });
    out[type] = r ? r.dish.id : null;
    if (r) skip.push(r.dish.id);
  }
  return out;
}

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
      const g = groupOf(ing);
      if (g && H.has(g)) hit.add(g);
      else if (!isPantry(ing)) missing.push(ing);
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
  return weighted(top, (m) => weightOf(m.dish, (o.stats || {})[m.dish.id], o.today), o.rng || Math.random).dish;
}

// ---------- week plan & shopping ----------
export function weekDates(start) { return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }

/** Fills the empty days (today or later) of a week with one dish each, no repeats within the week. Returns { date: [id] }. */
export function fillWeek(dishes, plan, dates, o) {
  const used = dates.flatMap((d) => plan[d] || []);
  const out = {};
  for (const d of dates) {
    if (d < o.today || (plan[d] && plan[d].length)) continue;
    const r = pickOne(dishes, { ...o, skip: used, filter: { ...(o.filter || {}), type: o.filter && o.filter.type !== 'all' ? o.filter.type : 'all' } });
    if (!r) break;
    out[d] = [r.dish.id];
    used.push(r.dish.id);
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
