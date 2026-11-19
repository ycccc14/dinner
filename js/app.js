// 今晚吃啥 — the whole user interface. Screens are plain template strings rendered into #view on hash change.
import * as DB from './db.js';
import { DISHES, CUISINES, TYPES, LEVELS, TASTES, FRIDGE, FOOD_EMOJI } from './dishes.js';
import {
  today, parseDate, addDays, weekStart, weekday, fmtDate, relDays, greeting, monthGrid, addMonths,
  mergeDishes, splitIngs, isPantry, dishStats, matchesFilter, activeFilters, DEFAULT_FILTER, pickOne, pickCombo, COMBO,
  fridgeMatches, pickFridge, weekDates, fillWeek, shoppingFrom, mergeShop, streak, topDishes,
  searchQ, xhsApp, xhsWeb, xcfWeb, ytWeb, parseShared, stars,
} from './logic.js';

export const VERSION = '1.1.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const DEFAULTS = { avoidDays: 5, withPantry: false, hideInstall: false, filter: DEFAULT_FILTER };
const RATE_TXT = ['点星星打个分', '不太行 😣', '一般般 😐', '还不错 🙂', '好吃 😋', '超好吃！🤩'];
const QUICK = ['下次多放盐', '少放点盐', '少放油', '更辣一点', '火候小一点', '多煮一会', '酱汁多一点', '家人很喜欢', '可以常做'];

const S = {
  recs: [], dishes: [], logs: [], plan: {}, shop: [], settings: { ...DEFAULTS }, stats: {},
  ui: { mode: 'one', result: null, relaxed: false, combo: null, skip: [], fridge: [], fridgePick: null, lib: { q: '', chip: 'all', cuisine: 'all', type: 'all', taste: 'all' }, week: null, month: null, allLogs: false, spinning: false },
};

// ---------- data ----------
async function load() {
  const [recs, logs, plan, shop, kv] = await Promise.all(DB.STORES.map((s) => DB.all(s)));
  S.recs = recs;
  S.logs = logs;
  S.plan = Object.fromEntries(plan.map((p) => [p.id, p.dishes || []]));
  S.shop = shop;
  const st = kv.find((k) => k.id === 'settings');
  S.settings = { ...DEFAULTS, ...(st ? st.value : {}) };
  S.settings.filter = { ...DEFAULT_FILTER, ...(S.settings.filter || {}) };
  refresh();
}
function refresh() { S.dishes = mergeDishes(DISHES, S.recs); S.stats = dishStats(S.logs); }
const dishById = (id) => S.dishes.find((d) => d.id === id);
const saveSettings = () => DB.put('kv', { id: 'settings', value: S.settings });
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0));

async function saveRec(id, patch, replace) {
  const cur = replace ? { id } : S.recs.find((r) => r.id === id) || { id };
  const rec = { ...cur, ...patch, id, updatedAt: Date.now() };
  await DB.put('dishes', rec);
  S.recs = [...S.recs.filter((r) => r.id !== id), rec];
  refresh();
  return rec;
}
async function setPlan(date, ids) {
  ids = [...new Set(ids)];
  if (ids.length) { S.plan[date] = ids; await DB.put('plan', { id: date, dishes: ids }); } else { delete S.plan[date]; await DB.del('plan', date); }
}
async function saveShop(list) {
  const gone = S.shop.filter((x) => !list.some((y) => y.id === x.id));
  for (const g of gone) await DB.del('shop', g.id);
  await DB.putMany('shop', list);
  S.shop = list;
}
function pickOpts(extraSkip) {
  return { filter: S.settings.filter, stats: S.stats, today: today(), avoidDays: Number(S.settings.avoidDays) || 0, skip: [...S.ui.skip, ...(S.plan[today()] || []), ...(extraSkip || [])] };
}

// ---------- small UI helpers ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function sheet(title, html, opts) {
  opts = opts || {};
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet ${opts.cls || ''}" role="dialog" aria-label="${esc(title)}">
    <div class="sheet-head"><b>${esc(title)}</b><button class="x" data-close aria-label="关闭">✕</button></div>
    <div class="sheet-body">${html}</div>${opts.foot ? `<div class="sheet-foot">${opts.foot}</div>` : ''}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const api = {
    el: wrap,
    body: $('.sheet-body', wrap),
    close() {
      if (closed) return;
      closed = true;
      wrap.className = 'sheet-closing';
      setTimeout(() => wrap.remove(), 220);
      if (opts.onClose) opts.onClose();
    },
  };
  wrap.addEventListener('click', (e) => { if (e.target.classList.contains('sheet-bg') || e.target.closest('[data-close]')) api.close(); });
  return api;
}

function ask(title, msg, ok, danger) {
  return new Promise((resolve) => {
    let answered = false;
    const sh = sheet(title, `<p class="ask">${esc(msg)}</p>`, {
      cls: 'small',
      foot: `<button class="btn ghost" data-close>取消</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok || '确定')}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    $('[data-ok]', sh.el).onclick = () => { answered = true; resolve(true); sh.close(); };
  });
}

// One persistent file input (iOS only opens pickers from inputs that are in the page).
const fileIn = document.createElement('input');
fileIn.type = 'file';
fileIn.hidden = true;
document.body.appendChild(fileIn);
function pickFile(accept) {
  return new Promise((resolve) => {
    fileIn.accept = accept;
    fileIn.value = '';
    fileIn.onchange = () => resolve(fileIn.files[0] || null);
    fileIn.click();
  });
}
async function shrink(file, max = 1280, q = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('这张图片打不开')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  } finally { URL.revokeObjectURL(url); }
}

// ---------- pieces ----------
const cuis = (d) => CUISINES[d.cuisine] || CUISINES.cn;
const typ = (d) => TYPES[d.type] || TYPES.meat;
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分钟`);
function plate(d, size, noPhoto) {
  const st = S.stats[d.id];
  const ph = !noPhoto && st && st.photo;
  return `<span class="plate ${size || ''}" style="--c:${cuis(d).color}">${ph ? `<img src="${ph}" alt="">` : `<i>${esc(d.emoji || '🍽️')}</i>`}</span>`;
}
const metaTags = (d) => `<div class="tags"><span class="tag cz" style="--c:${cuis(d).color}">${cuis(d).emoji} ${cuis(d).name}</span><span class="tag">${typ(d).emoji} ${typ(d).name}</span><span class="tag">⏱ ${fmtMin(d.time)}</span><span class="tag">${LEVELS[d.level] || '新手友好'}</span>${d.taste === 'light' ? '<span class="tag lt">🥗 清淡</span>' : d.taste === 'heavy' ? '<span class="tag hv">🔥 重口</span>' : ''}</div>`;
function noteBox(d) {
  const st = S.stats[d.id];
  if (!st || !st.lastNote) return '';
  const n = st.lastNote;
  return `<div class="note"><div class="nhead"><b>📝 上次的笔记</b><span>${fmtDate(n.date, false)}${n.rating ? ' · ' + stars(n.rating) : ''}</span></div><p>${esc(n.text)}</p></div>`;
}
function cookedLine(d) {
  const st = S.stats[d.id];
  return st ? `做过 ${st.count} 次 · 上次 ${relDays(st.last, today())}${st.rated ? ` · ★ ${st.avg.toFixed(1)}` : ''}` : '✨ 还没做过，试试新菜';
}
const srcIcon = (s) => ({ xhs: '📕', yt: '▶️', xcf: '🍳' }[s] || '🔗');
const recipeBtns = (d) => `<a class="btn xhs" href="${xhsApp(searchQ(d))}">📕 小红书看做法</a>`;
const myLinkBtn = (d) => (d.links.length ? `<a class="btn mine block" href="${esc(d.links[0].url)}" target="_blank" rel="noopener">📌 打开我收藏的做法${d.links[0].title ? `：${esc(d.links[0].title)}` : ''}</a>` : '');

function emptyPlate(emoji, text) {
  return `<div class="hero-empty"><span class="plate xl idle"><i>${emoji}</i></span><p>${esc(text)}</p></div>`;
}

function resultCard(d, extra) {
  return `<div class="result card pop">
    <a class="rhead" href="#dish/${d.id}">${plate(d, 'xl')}<h2>${esc(d.name)}</h2>${d.en ? `<div class="en">${esc(d.en)}</div>` : ''}</a>
    ${metaTags(d)}
    <p class="cooked">${cookedLine(d)}</p>
    ${extra || ''}${noteBox(d)}
    ${S.ui.relaxed && S.ui.mode === 'one' ? '<p class="hint">符合条件的菜最近都做过了，这道是从里面挑的</p>' : ''}
    <div class="btns two">${recipeBtns(d)}<button class="btn primary" data-act="choose" data-id="${d.id}">👍 就它了</button></div>
    ${myLinkBtn(d)}
    <div class="btns center"><button class="btn ghost sm" data-act="nope" data-id="${d.id}">🙅 不想吃这个</button><a class="btn ghost sm" href="#dish/${d.id}">详情 ›</a></div>
  </div>`;
}

function comboCard(c) {
  const rows = COMBO.map((k) => {
    const d = c[k] && dishById(c[k]);
    if (!d) return `<div class="crow"><span class="plate md"><i>${TYPES[k].emoji}</i></span><div class="grow"><small>${TYPES[k].name}</small><b class="muted">没有合适的</b></div><button class="btn round soft sm" data-act="combo-reroll" data-k="${k}" aria-label="换一道">↻</button></div>`;
    return `<div class="crow"><a class="cmain" href="#dish/${d.id}">${plate(d, 'md')}<div class="grow"><small>${TYPES[k].name} · ${d.time} 分钟</small><b>${esc(d.name)}</b>${S.stats[d.id] && S.stats[d.id].lastNote ? `<span class="cnote">📝 ${esc(S.stats[d.id].lastNote.text)}</span>` : ''}</div></a>
      <a class="btn round xhs sm" href="${xhsApp(searchQ(d))}" aria-label="小红书看做法">📕</a><button class="btn round soft sm" data-act="combo-reroll" data-k="${k}" aria-label="换一道">↻</button></div>`;
  }).join('');
  const total = COMBO.reduce((s, k) => s + ((c[k] && dishById(c[k]) || {}).time || 0), 0);
  return `<div class="card combo pop"><div class="chead"><b>🍱 今晚两菜一汤</b><span class="muted sm">合计约 ${fmtMin(total)}</span></div>${rows}
    <div class="btns two"><button class="btn primary" data-act="choose-combo">👍 就这些</button><button class="btn soft" data-act="shop-dishes" data-ids="${COMBO.map((k) => c[k]).filter(Boolean).join(',')}">🛒 买食材</button></div></div>`;
}

function fridgeStage() {
  const ui = S.ui;
  const chips = `<div class="fchips">${FRIDGE.map(([g, e]) => `<button class="fchip ${ui.fridge.includes(g) ? 'on' : ''}" data-act="fridge" data-v="${g}"><span>${e}</span>${g}</button>`).join('')}</div>`;
  if (!ui.fridge.length) return `<p class="lead">家里有什么？点一下选上（可以多选）</p>${chips}${emptyPlate('🧊', '选好食材，看看今晚能做什么')}`;
  const ms = fridgeMatches(S.dishes, ui.fridge, { filter: S.settings.filter });
  const pick = ui.fridgePick && ms.find((m) => m.dish.id === ui.fridgePick);
  const fx = (m) => `<div class="fx"><span class="ok">✓ 用到 ${m.hit.map(esc).join('、')}</span>${m.missing.length ? `<span class="need">还要买：${m.missing.map(esc).join('、')}</span>` : '<span class="ok">食材都齐了 🎉</span>'}</div>`;
  return `<p class="lead">家里有什么？点一下选上（可以多选）<button class="link" data-act="fridge-clear">清空</button></p>${chips}
    ${pick ? resultCard(pick.dish, fx(pick)) : ''}
    ${ms.length ? `<button class="btn primary huge block" data-act="fridge-pick">🎲 从能做的 ${ms.length} 道里挑一道</button>` : ''}
    <h3 class="sec">能做的菜 <span class="count">${ms.length}</span></h3>
    ${ms.length ? ms.slice(0, 15).map((m) => `<a class="mrow card" href="#dish/${m.dish.id}">${plate(m.dish, 'sm')}<div class="grow"><b>${esc(m.dish.name)}</b><small class="muted">${m.dish.time} 分钟 · ${typ(m.dish).name}</small>${fx(m)}</div></a>`).join('') : '<div class="card muted center">这些食材还配不出菜，多选几样试试</div>'}`;
}

function stage() {
  const ui = S.ui;
  if (ui.mode === 'fridge') return fridgeStage();
  if (ui.mode === 'combo') {
    return (ui.combo ? comboCard(ui.combo) : emptyPlate('🍱', '一荤一素一汤，帮你配好一桌')) +
      `<button class="btn primary huge block" data-act="spin">${ui.combo ? '🎲 全部重抽' : '🎲 帮我配一桌'}</button>`;
  }
  const d = ui.result && dishById(ui.result);
  const n = S.dishes.filter((x) => !x.hidden && matchesFilter(x, S.settings.filter)).length;
  return (d ? resultCard(d) : emptyPlate('🍽️', `从 ${n} 道菜里帮你挑一道`)) +
    `<button class="btn primary huge block" data-act="spin">${d ? '🎲 换一个' : '🎲 帮我挑'}</button>`;
}

function filterSummary(f) {
  const p = [];
  p.push(f.cuisine !== 'all' && CUISINES[f.cuisine] ? CUISINES[f.cuisine].name : '全部菜系');
  if (f.type !== 'all' && TYPES[f.type] && S.ui.mode !== 'combo') p.push(TYPES[f.type].name);
  if (f.maxTime) p.push(`${f.maxTime} 分钟内`);
  if (f.level) p.push(f.level === 1 ? '新手友好' : '别太难');
  if (f.taste === 'all') p.push('口味不限');
  if (f.favOnly) p.push('只挑收藏');
  return p.join(' · ');
}

function logRow(l, inDish) {
  const d = dishById(l.dishId) || { id: '', name: '已删除的菜', emoji: '🍽️', cuisine: 'cn' };
  return `<div class="lrow card" data-act="log-edit" data-id="${l.id}" role="button" tabindex="0">
    ${inDish ? '' : plate(d, 'sm', !!l.photo)}
    <div class="grow"><div class="lt"><b>${inDish ? fmtDate(l.date) : esc(d.name)}</b>${l.rating ? `<span class="stars">${stars(l.rating)}</span>` : ''}</div>
    <div class="muted sm">${inDish ? relDays(l.date, today()) : `${fmtDate(l.date)} · ${relDays(l.date, today())}`}</div>
    ${l.note ? `<p class="lnote">📝 ${esc(l.note)}</p>` : ''}</div>
    ${l.photo ? `<img class="lph" src="${l.photo}" alt="">` : ''}
  </div>`;
}

function tonightCard(list) {
  const t = today();
  const done = new Set(S.logs.filter((l) => l.date === t).map((l) => l.dishId));
  return `<section class="card tonight">
    <div class="thead"><b>🍽 今晚菜单</b><a class="link" href="#plan">改菜单 ›</a></div>
    ${list.map((d) => `<div class="trow"><a class="tmain" href="#dish/${d.id}">${plate(d, 'sm')}<span class="grow"><b>${esc(d.name)}</b><small>${d.time} 分钟${S.stats[d.id] && S.stats[d.id].lastNote ? ' · 📝 有笔记' : ''}</small></span></a>
      ${done.has(d.id) ? '<span class="tag green">✓ 已记录</span>' : `<a class="btn round xhs sm" href="${xhsApp(searchQ(d))}" aria-label="小红书看做法">📕</a><button class="btn primary sm" data-act="log-new" data-id="${d.id}">做好了</button>`}</div>`).join('')}
    <button class="btn soft sm block" data-act="shop-dishes" data-ids="${list.map((d) => d.id).join(',')}">🛒 把食材加进购物清单</button>
  </section>`;
}

// ---------- screens ----------
function Home() {
  const t = today();
  const ui = S.ui;
  const f = S.settings.filter;
  const nf = activeFilters(f);
  const tonight = (S.plan[t] || []).map(dishById).filter(Boolean);
  const recent = [...S.logs].sort(byDateDesc).slice(0, 3);
  const install = IOS && !STANDALONE && !S.settings.hideInstall;
  return `
  <header class="top"><div><div class="hello">${greeting(new Date().getHours())} · ${fmtDate(t)}</div><h1>今晚吃啥？</h1></div><a class="btn round ghost" href="#me" aria-label="设置">⚙️</a></header>
  ${install ? `<div class="install card"><span>📲</span><p>装到主屏幕更好用：点 Safari 下方的 <b>Share</b>，再选 <b>Add to Home Screen</b></p><button class="x" data-act="install-hide" aria-label="不再显示">✕</button></div>` : ''}
  ${tonight.length ? tonightCard(tonight) : ''}
  <div class="seg">${[['one', '🎲', '来一道'], ['combo', '🍱', '两菜一汤'], ['fridge', '🧊', '冰箱有啥']].map(([k, e, l]) => `<button class="${ui.mode === k ? 'on' : ''}" data-act="mode" data-v="${k}"><span>${e}</span>${l}</button>`).join('')}</div>
  <div class="taste">${[['daily', '🍚', '日常家常'], ['light', '🥗', '少油少盐'], ['heavy', '🔥', '油炸重口']].map(([k, e, l]) => `<button class="${f.taste === k ? 'on ' + k : ''}" data-act="taste" data-v="${k}"><span>${e}</span>${l}</button>`).join('')}</div>
  <button class="filterbar" data-act="filters"><span class="fl">筛选</span><span class="fsum">${esc(filterSummary(f))}</span>${nf ? `<b class="count">${nf}</b>` : ''}<span class="chev">›</span></button>
  <section id="stage" class="stage">${stage()}</section>
  ${recent.length ? `<h3 class="sec">最近做过 <a class="more" href="#log">全部 ›</a></h3>${recent.map((l) => logRow(l)).join('')}` : ''}`;
}

const LIB_CHIPS = [['all', '全部'], ['fav', '❤️ 收藏'], ['new', '✨ 没做过'], ['done', '✅ 做过的'], ['mine', '👤 我加的'], ['hidden', '🙈 不抽的']];
function libList() {
  const L = S.ui.lib;
  const q = L.q.trim().toLowerCase();
  let list = S.dishes.filter((d) => {
    const st = S.stats[d.id];
    if (L.chip === 'hidden' ? !d.hidden : L.chip !== 'all' && d.hidden && L.chip !== 'mine') return false;
    if (L.chip === 'fav' && !d.fav) return false;
    if (L.chip === 'new' && st) return false;
    if (L.chip === 'done' && !st) return false;
    if (L.chip === 'mine' && d.builtin) return false;
    if (L.cuisine !== 'all' && d.cuisine !== L.cuisine) return false;
    if (L.type !== 'all' && d.type !== L.type) return false;
    if (L.taste !== 'all' && (d.taste || 'normal') !== L.taste) return false;
    if (q && !`${d.name} ${d.en || ''} ${d.ings.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (L.chip === 'done') list = list.sort((a, b) => S.stats[b.id].count - S.stats[a.id].count);
  else list = [...list.filter((d) => d.fav), ...list.filter((d) => !d.fav)];
  return list;
}
function libGrid() {
  const list = libList();
  if (!list.length) return `<div class="empty">${S.ui.lib.q ? '没找到这道菜' : '这里还是空的'}<br><button class="btn primary" data-act="dish-new">＋ 添加我的菜</button></div>`;
  return `<p class="muted sm">${list.length} 道</p><div class="grid">${list.map((d) => {
    const st = S.stats[d.id];
    return `<a class="dcard ${d.hidden ? 'dim' : ''}" href="#dish/${d.id}">${d.fav ? '<span class="heart">❤️</span>' : ''}${plate(d, 'lg')}<b>${esc(d.name)}</b><small>${d.taste === 'light' ? '🥗 ' : d.taste === 'heavy' ? '🔥 ' : ''}${typ(d).name} · ${d.time} 分钟</small>${st ? `<span class="badge">做过 ${st.count} 次</span>` : ''}</a>`;
  }).join('')}</div>`;
}
function Dishes() {
  const L = S.ui.lib;
  return `
  <header class="top"><div><div class="hello">${S.dishes.filter((d) => !d.hidden).length} 道菜可以抽</div><h1>菜谱</h1></div><button class="btn round primary" data-act="dish-new" aria-label="添加我的菜">＋</button></header>
  <div class="search"><span>🔍</span><input type="search" data-lib-q placeholder="搜菜名或食材，比如 鸡蛋" value="${esc(L.q)}" enterkeyhint="search"></div>
  <div class="chips">${LIB_CHIPS.map(([k, l]) => `<button class="chip ${L.chip === k ? 'on' : ''}" data-act="lib-chip" data-v="${k}">${l}</button>`).join('')}</div>
  <div class="sels"><label><select data-lib-sel="cuisine" aria-label="菜系"><option value="all">全部菜系</option>${Object.entries(CUISINES).map(([k, c]) => `<option value="${k}" ${L.cuisine === k ? 'selected' : ''}>${c.emoji} ${c.name}</option>`).join('')}</select></label>
    <label><select data-lib-sel="type" aria-label="类型"><option value="all">全部类型</option>${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${L.type === k ? 'selected' : ''}>${t.emoji} ${t.name}</option>`).join('')}</select></label>
    <label><select data-lib-sel="taste" aria-label="口味"><option value="all">全部口味</option>${Object.entries(TASTES).map(([k, t]) => `<option value="${k}" ${L.taste === k ? 'selected' : ''}>${t.emoji} ${t.name}</option>`).join('')}</select></label></div>
  <div id="grid">${libGrid()}</div>`;
}

function DishPage(id) {
  const d = dishById(id);
  if (!d) return `<div class="bar"><button class="back" data-act="back" aria-label="返回">‹</button><b>菜谱</b><span></span></div><div class="empty">找不到这道菜<br><a class="btn" href="#dishes">回菜谱</a></div>`;
  const st = S.stats[d.id];
  const logs = S.logs.filter((l) => l.dishId === id).sort(byDateDesc);
  const q = searchQ(d);
  const hasPantry = d.ings.some(isPantry);
  return `
  <div class="bar"><button class="back" data-act="back" aria-label="返回">‹</button><b>${esc(d.name)}</b><button class="btn ghost sm" data-act="edit-dish" data-id="${d.id}">编辑</button></div>
  <section class="dhero">${plate(d, 'xxl')}<h1>${esc(d.name)}</h1>${d.en ? `<div class="en">${esc(d.en)}</div>` : ''}${metaTags(d)}</section>
  <div class="stats3"><div><b>${st ? st.count : 0}</b><span>做过（次）</span></div><div><b>${st && st.rated ? st.avg.toFixed(1) : '–'}</b><span>平均评分</span></div><div><b>${st ? relDays(st.last, today()) : '–'}</b><span>上次做</span></div></div>
  ${noteBox(d)}
  <div class="btns two">${recipeBtns(d)}<button class="btn primary" data-act="log-new" data-id="${d.id}">✅ 我做了</button></div>
  ${myLinkBtn(d)}
  <div class="acts">
    <button class="${d.fav ? 'on' : ''}" data-act="fav" data-id="${d.id}"><span>${d.fav ? '❤️' : '🤍'}</span>${d.fav ? '已收藏' : '收藏'}</button>
    <button data-act="to-plan" data-id="${d.id}"><span>📅</span>加入菜单</button>
    <button data-act="shop-dishes" data-ids="${d.id}"><span>🛒</span>买食材</button>
    <button class="${d.hidden ? 'on' : ''}" data-act="hide" data-id="${d.id}"><span>${d.hidden ? '🙈' : '🚫'}</span>${d.hidden ? '已不抽它' : '别抽到它'}</button>
  </div>
  <section class="card"><h3>📌 我收藏的做法</h3>
    ${d.links.length ? d.links.map((l, i) => `<div class="link-row"><a href="${esc(l.url)}" target="_blank" rel="noopener"><span>${srcIcon(l.src)}</span><span class="lt">${esc(l.title || l.url)}</span></a><button class="x" data-act="link-del" data-id="${d.id}" data-i="${i}" aria-label="删除这个链接">✕</button></div>`).join('')
      : '<p class="muted sm">在小红书找到好用的做法？点笔记右上角「分享 → 复制链接」，回来这里粘贴，下次一点就打开。</p>'}
    <button class="btn soft block" data-act="link-add" data-id="${d.id}">＋ 粘贴做法链接</button>
  </section>
  <section class="card"><h3>🧺 主要食材</h3><div class="ings">${d.ings.map((i) => `<span class="ing ${isPantry(i) ? 'pantry' : ''}">${esc(i)}</span>`).join('') || '<span class="muted sm">还没填食材</span>'}</div>
    ${hasPantry ? '<p class="muted xs">灰色的是常备调料，默认不加进购物清单</p>' : ''}</section>
  <h3 class="sec">🗒 做菜记录 ${logs.length ? `<span class="count">${logs.length}</span>` : ''}</h3>
  ${logs.length ? logs.map((l) => logRow(l, true)).join('') : '<div class="card muted sm center">做完点「✅ 我做了」，记下评分和下次要改进的地方</div>'}
  <div class="more-search"><span>其他地方搜做法</span><a href="${xhsWeb(q)}" target="_blank" rel="noopener">小红书网页版</a><a href="${xcfWeb(q)}" target="_blank" rel="noopener">下厨房</a><a href="${ytWeb(q)}" target="_blank" rel="noopener">YouTube</a></div>`;
}

function Plan() {
  const t = today();
  const ws = S.ui.week || weekStart(t);
  const dates = weekDates(ws);
  const left = S.shop.filter((x) => !x.done).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const done = S.shop.filter((x) => x.done);
  const thisWeek = ws === weekStart(t);
  const item = (x) => `<div class="sitem ${x.done ? 'done' : ''}"><button class="check" data-act="shop-toggle" data-id="${x.id}" aria-label="${x.done ? '标为未买' : '买到了'}">${x.done ? '✓' : ''}</button>
    <div class="grow"><span>${esc(x.name)}</span>${x.for && x.for.length ? `<small>${esc(x.for.join('、'))}</small>` : ''}</div><button class="x" data-act="shop-del" data-id="${x.id}" aria-label="删除">✕</button></div>`;
  return `
  <header class="top"><div><div class="hello">提前排好，买菜不用想</div><h1>菜单</h1></div></header>
  <div class="weeknav"><button class="btn round ghost" data-act="week" data-v="-1" aria-label="上一周">‹</button><b>${fmtDate(ws, false)} – ${fmtDate(dates[6], false)}${thisWeek ? '<small>本周</small>' : ''}</b><button class="btn round ghost" data-act="week" data-v="1" aria-label="下一周">›</button></div>
  <div class="days card">${dates.map((date) => {
    const ids = S.plan[date] || [];
    return `<div class="day ${date === t ? 'today' : ''} ${date < t ? 'past' : ''}"><div class="dl"><b>${weekday(date)}</b><span>${parseDate(date).getDate()}</span></div>
      <div class="db">${ids.map((id) => { const d = dishById(id); return d ? `<span class="pchip"><a href="#dish/${d.id}">${esc(d.emoji)} ${esc(d.name)}</a><button data-act="plan-rm" data-date="${date}" data-id="${d.id}" aria-label="移除">✕</button></span>` : ''; }).join('')}
      <button class="padd" data-act="plan-add" data-date="${date}" aria-label="安排">＋${ids.length ? '' : ' 安排'}</button></div></div>`;
  }).join('')}</div>
  <div class="btns two"><button class="btn soft" data-act="fill-week">🎲 空的日子帮我排</button><button class="btn soft" data-act="shop-week">🛒 生成购物清单</button></div>
  <h3 class="sec" id="shop">🛒 购物清单 ${left.length ? `<span class="count">${left.length}</span>` : ''}</h3>
  <form class="addrow" data-form="shop-add"><input name="item" placeholder="加一样要买的，比如 鸡蛋" enterkeyhint="done" autocomplete="off"><button class="btn primary">添加</button></form>
  ${left.length || done.length ? `<div class="card shoplist">${left.map(item).join('')}${done.map(item).join('')}</div>` : '<div class="card muted sm center">清单是空的。排好菜单后点「生成购物清单」，食材会自动加进来</div>'}
  ${done.length ? `<button class="btn ghost sm" data-act="shop-clear">清除已买的（${done.length}）</button>` : ''}`;
}

function LogPage() {
  const t = today();
  const ym = S.ui.month || t.slice(0, 7);
  const thisMonth = S.logs.filter((l) => l.date.startsWith(t.slice(0, 7))).length;
  const byDay = {};
  for (const l of S.logs) (byDay[l.date] = byDay[l.date] || []).push(l);
  const top = topDishes(S.stats, 5);
  const sorted = [...S.logs].sort(byDateDesc);
  const shown = S.ui.allLogs ? sorted : sorted.slice(0, 40);
  const groups = [];
  for (const l of shown) { const k = l.date.slice(0, 7); let g = groups[groups.length - 1]; if (!g || g.k !== k) groups.push(g = { k, list: [] }); g.list.push(l); }
  const [y, m] = ym.split('-').map(Number);
  return `
  <header class="top"><div><div class="hello">每一顿都值得记下来</div><h1>做菜记录</h1></div><a class="btn round ghost" href="#me" aria-label="设置">⚙️</a></header>
  <div class="stats3"><div><b>${thisMonth}</b><span>本月做了（次）</span></div><div><b>${streak(S.logs, t)}</b><span>连续下厨（天）</span></div><div><b>${Object.keys(S.stats).length}</b><span>做过的菜（道）</span></div></div>
  <section class="card cal">
    <div class="calnav"><button class="btn round ghost sm" data-act="month" data-v="-1" aria-label="上个月">‹</button><b>${y}年${m}月</b><button class="btn round ghost sm" data-act="month" data-v="1" aria-label="下个月">›</button></div>
    <div class="calgrid">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span class="wd">${w}</span>`).join('')}
    ${monthGrid(ym).map((d) => {
      if (!d) return '<span></span>';
      const ls = byDay[d] || [];
      const first = ls.length && dishById(ls[0].dishId);
      return `<button class="cd ${ls.length ? 'has' : ''} ${d === t ? 'today' : ''}" ${ls.length ? `data-act="day" data-date="${d}"` : 'disabled'}><span>${parseDate(d).getDate()}</span>${first ? `<i>${esc(first.emoji)}</i>` : ''}${ls.length > 1 ? `<em>${ls.length}</em>` : ''}</button>`;
    }).join('')}</div>
  </section>
  ${top.length ? `<h3 class="sec">🏆 最常做</h3><div class="card">${top.map((x, i) => { const d = dishById(x.id); return d ? `<a class="rank" href="#dish/${d.id}"><span class="no">${i + 1}</span>${plate(d, 'sm')}<span class="grow"><b>${esc(d.name)}</b><small>${x.rated ? `★ ${x.avg.toFixed(1)} · ` : ''}上次 ${relDays(x.last, t)}</small></span><span class="times">${x.count} 次</span></a>` : ''; }).join('')}</div>` : ''}
  <h3 class="sec">🗒 全部记录 ${S.logs.length ? `<span class="count">${S.logs.length}</span>` : ''}</h3>
  ${S.logs.length ? groups.map((g) => `<h4>${Number(g.k.slice(0, 4))}年${Number(g.k.slice(5))}月</h4>${g.list.map((l) => logRow(l)).join('')}`).join('') : `<div class="empty">还没有记录<br>做完饭，在菜的页面点「✅ 我做了」<br><a class="btn primary" href="#home">🎲 先去抽一道</a></div>`}
  ${sorted.length > shown.length ? `<button class="btn ghost block" data-act="logs-all">显示全部 ${sorted.length} 条</button>` : ''}`;
}

function Me() {
  const s = S.settings;
  return `
  <div class="bar"><button class="back" data-act="back" aria-label="返回">‹</button><b>设置</b><span></span></div>
  <section class="card"><h3>🎲 抽菜</h3>
    <label class="srow"><span class="grow">避开最近几天做过的菜<small>设 0 就不避开</small></span><input type="number" inputmode="numeric" min="0" max="60" data-set="avoidDays" value="${esc(s.avoidDays)}"></label>
    <label class="srow"><span class="grow">购物清单也加调料<small>姜、蒜、酱油这些常备的</small></span><input type="checkbox" class="switch" data-set="withPantry" ${s.withPantry ? 'checked' : ''}></label>
  </section>
  <section class="card"><h3>💾 资料</h3><p class="muted sm">所有资料只存在这台手机上。换手机或清除 Safari 资料前，记得先导出备份。</p>
    <div class="btns"><button class="btn soft" data-act="export">📤 导出备份</button><button class="btn soft" data-act="import">📥 导入备份</button></div>
    <div class="btns"><button class="btn ghost danger-t" data-act="wipe">🗑 清空所有资料</button></div>
  </section>
  <section class="card"><h3>📲 装到 iPhone 主屏幕</h3><ol class="steps"><li>用 <b>Safari</b> 打开这个网页</li><li>点下方的 <b>Share</b> 按钮（方框加箭头）</li><li>往下滑，点 <b>Add to Home Screen</b> → <b>Add</b></li></ol><p class="muted sm">之后从主屏幕图标打开，就像普通 App 一样，没网也能用。</p></section>
  <p class="about">今晚吃啥 v${VERSION} · ${S.dishes.length} 道菜 · ${S.logs.length} 条记录</p>`;
}

// ---------- sheets ----------
function filterSheet() {
  const f = { ...S.settings.filter };
  const opt = (k, v, label) => `<button type="button" class="chip ${f[k] === v ? 'on' : ''}" data-k="${k}" data-v="${v}">${label}</button>`;
  const body = () => {
    const n = S.dishes.filter((d) => !d.hidden && matchesFilter(d, S.ui.mode === 'combo' ? { ...f, type: 'all' } : f)).length;
    const heavyCombo = S.ui.mode === 'combo' && f.taste === 'heavy' ? '<small>两菜一汤时只有荤菜重口，素菜和汤照常清淡</small>' : '';
    return `<h4>菜系</h4><div class="chips">${opt('cuisine', 'all', '全部')}${Object.entries(CUISINES).map(([k, c]) => opt('cuisine', k, `${c.emoji} ${c.name}`)).join('')}</div>
    <h4>类型 ${S.ui.mode === 'combo' ? '<small>两菜一汤模式不看这一项</small>' : ''}</h4><div class="chips">${opt('type', 'all', '全部')}${Object.entries(TYPES).map(([k, t]) => opt('type', k, `${t.emoji} ${t.name}`)).join('')}</div>
    <h4>口味 ${heavyCombo}</h4><div class="chips">${[['daily', '🍚 日常（不油炸不重口）'], ['light', '🥗 少油少盐'], ['heavy', '🔥 油炸重口'], ['all', '口味不限']].map(([v, l]) => opt('taste', v, l)).join('')}</div>
    <h4>时间</h4><div class="chips">${[[0, '不限'], [15, '15 分钟内'], [30, '30 分钟内'], [60, '1 小时内']].map(([v, l]) => opt('maxTime', v, l)).join('')}</div>
    <h4>难度</h4><div class="chips">${[[1, '🔰 新手友好'], [2, '别太难'], [0, '不限']].map(([v, l]) => opt('level', v, l)).join('')}</div>
    <h4>其他</h4><div class="chips"><button type="button" class="chip ${f.favOnly ? 'on' : ''}" data-k="favOnly" data-v="toggle">❤️ 只从收藏里挑</button></div>
    <p class="fcount ${n ? '' : 'red-t'}">符合条件：${n} 道菜</p>`;
  };
  const sh = sheet('筛选', body(), {
    foot: '<button class="btn ghost" data-reset>重置</button><button class="btn primary grow" data-close>完成</button>',
    onClose: async () => {
      if (JSON.stringify(f) === JSON.stringify(S.settings.filter)) return;
      S.settings.filter = f; await saveSettings(); S.ui.result = null; S.ui.combo = null; S.ui.fridgePick = null; S.ui.skip = []; render();
    },
  });
  sh.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (b) {
      const k = b.dataset.k;
      if (k === 'favOnly') f.favOnly = !f.favOnly;
      else f[k] = k === 'maxTime' || k === 'level' ? Number(b.dataset.v) : b.dataset.v;
      sh.body.innerHTML = body();
    }
    if (e.target.closest('[data-reset]')) { Object.assign(f, DEFAULT_FILTER); sh.body.innerHTML = body(); }
  });
}

function logSheet(dishId, logId, date) {
  const old = logId && S.logs.find((l) => l.id === logId);
  const d = dishById(old ? old.dishId : dishId) || { id: '', name: '已删除的菜', emoji: '🍽️', cuisine: 'cn' };
  const st = { rating: old ? old.rating || 0 : 0, photo: old ? old.photo || null : null };
  const photoRow = () => `${st.photo ? `<div class="ph"><img src="${st.photo}" alt=""><button type="button" class="x" data-rmphoto aria-label="删除照片">✕</button></div>` : ''}<button type="button" class="btn soft sm" data-photo>📷 ${st.photo ? '换一张' : '加照片'}</button>`;
  const html = `
    <div class="lhead">${plate(d, 'md')}<div class="grow"><b>${esc(d.name)}</b><div class="muted sm">${d.id ? cookedLine(d) : ''}</div></div></div>
    <label class="field"><span>哪天做的</span><input type="date" name="date" value="${esc(old ? old.date : date || today())}" max="${today()}"></label>
    <div class="field"><span>好吃吗？</span><div class="starpick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= st.rating ? 'on' : ''}" aria-label="${n} 星">★</button>`).join('')}</div><div class="starlbl">${RATE_TXT[st.rating]}</div></div>
    <label class="field"><span>笔记 · 下次要改进的</span><textarea name="note" rows="3" placeholder="比如：下次多放点盐、火候小一点…">${esc(old ? old.note || '' : '')}</textarea></label>
    <div class="qchips">${QUICK.map((q) => `<button type="button" data-q="${q}">${q}</button>`).join('')}</div>
    <div class="field"><span>照片（可选）</span><div class="photo-row">${photoRow()}</div></div>`;
  const sh = sheet(old ? '编辑记录' : '记一笔 ✍️', html, {
    foot: `${old ? '<button class="btn ghost danger-t" data-del>删除</button>' : '<button class="btn ghost" data-close>取消</button>'}<button class="btn primary grow" data-save>保存</button>`,
  });
  const ta = $('[name=note]', sh.el);
  sh.el.addEventListener('click', async (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      st.rating = Number(star.dataset.star) === st.rating ? 0 : Number(star.dataset.star);
      $$('[data-star]', sh.el).forEach((b) => b.classList.toggle('on', Number(b.dataset.star) <= st.rating));
      $('.starlbl', sh.el).textContent = RATE_TXT[st.rating];
      return;
    }
    const q = e.target.closest('[data-q]');
    if (q) { const v = ta.value.trim(); ta.value = v ? `${v.replace(/[，,。.]$/, '')}，${q.dataset.q}` : q.dataset.q; return; }
    if (e.target.closest('[data-photo]')) {
      const f = await pickFile('image/*');
      if (!f) return;
      try { st.photo = await shrink(f); $('.photo-row', sh.el).innerHTML = photoRow(); } catch (err) { toast(err.message); }
      return;
    }
    if (e.target.closest('[data-rmphoto]')) { st.photo = null; $('.photo-row', sh.el).innerHTML = photoRow(); return; }
    if (e.target.closest('[data-del]')) {
      if (!(await ask('删除这条记录？', `${d.name} · ${fmtDate(old.date)}`, '删除', true))) return;
      await DB.del('logs', old.id);
      S.logs = S.logs.filter((l) => l.id !== old.id);
      refresh(); sh.close(); render(); toast('已删除');
      return;
    }
    if (e.target.closest('[data-save]')) {
      const dateV = $('[name=date]', sh.el).value || today();
      if (dateV > today()) { toast('还没到那天哦'); return; }
      const log = { id: old ? old.id : uid(), dishId: old ? old.dishId : dishId, date: dateV, rating: st.rating, note: ta.value.trim(), photo: st.photo, createdAt: old ? old.createdAt : Date.now() };
      await DB.put('logs', log);
      S.logs = [...S.logs.filter((l) => l.id !== log.id), log];
      refresh(); sh.close(); render();
      toast(old ? '已更新 ✓' : log.note ? '已记录 ✓ 下次抽到会提醒你这条笔记' : '已记录 ✓');
    }
  });
}

function dishForm(id) {
  const d = id ? dishById(id) : null;
  const st = { emoji: d ? d.emoji : '🍳', cuisine: d ? d.cuisine : 'cn', type: d ? d.type : 'meat', level: d ? d.level : 1, taste: d ? d.taste || 'normal' : 'light' };
  const rec = d && S.recs.find((r) => r.id === d.id);
  const chips = (k, entries) => `<div class="chips" data-chips="${k}">${entries.map(([v, l]) => `<button type="button" class="chip ${String(st[k]) === String(v) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const html = `
    <div class="emoji-pick"><button type="button" class="plate xl" data-emoji-open style="--c:${CUISINES[st.cuisine].color}"><i>${esc(st.emoji)}</i></button><small>点盘子换图标</small></div>
    <div class="egrid" hidden>${FOOD_EMOJI.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
    <label class="field"><span>菜名 *</span><input name="name" value="${esc(d ? d.name : '')}" placeholder="比如：妈妈的咖喱鸡" maxlength="30"></label>
    <label class="field"><span>英文名 / 备注名（可选）</span><input name="en" value="${esc(d ? d.en || '' : '')}" maxlength="50"></label>
    <div class="field"><span>菜系</span>${chips('cuisine', Object.entries(CUISINES).map(([k, c]) => [k, `${c.emoji} ${c.name}`]))}</div>
    <div class="field"><span>类型</span>${chips('type', Object.entries(TYPES).map(([k, t]) => [k, `${t.emoji} ${t.name}`]))}</div>
    <div class="field"><span>口味</span>${chips('taste', Object.entries(TASTES).map(([k, t]) => [k, `${t.emoji} ${t.name}`]))}</div>
    <div class="field"><span>难度</span>${chips('level', Object.entries(LEVELS))}</div>
    <label class="field"><span>大概要多久（分钟）</span><input name="time" type="number" inputmode="numeric" min="1" max="600" value="${esc(d ? d.time : 30)}"></label>
    <label class="field"><span>主要食材（空格或逗号分开）</span><textarea name="ings" rows="2" placeholder="鸡腿 土豆 洋葱">${esc(d ? d.ings.join(' ') : '')}</textarea></label>
    ${d ? '' : '<label class="field"><span>做法链接（可选，粘贴小红书分享的文字也行）</span><textarea name="link" rows="2" placeholder="http://xhslink.com/…"></textarea></label>'}`;
  let foot = '<button class="btn ghost" data-close>取消</button>';
  if (d && !d.builtin) foot = '<button class="btn ghost danger-t" data-del>删除</button>';
  else if (d && rec && rec.edited) foot = '<button class="btn ghost" data-restore>恢复默认</button>';
  const sh = sheet(d ? '编辑菜' : '添加我的菜', html, { foot: `${foot}<button class="btn primary grow" data-save>保存</button>` });
  sh.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-emoji-open]')) { $('.egrid', sh.el).hidden = !$('.egrid', sh.el).hidden; return; }
    const em = e.target.closest('[data-emoji]');
    if (em) { st.emoji = em.dataset.emoji; $('[data-emoji-open] i', sh.el).textContent = st.emoji; $('.egrid', sh.el).hidden = true; return; }
    const c = e.target.closest('[data-chips] [data-v]');
    if (c) {
      const k = c.parentElement.dataset.chips;
      st[k] = k === 'level' ? Number(c.dataset.v) : c.dataset.v;
      $$('[data-v]', c.parentElement).forEach((b) => b.classList.toggle('on', b === c));
      if (k === 'cuisine') $('[data-emoji-open]', sh.el).style.setProperty('--c', CUISINES[st.cuisine].color);
      return;
    }
    if (e.target.closest('[data-restore]')) {
      if (!(await ask('恢复默认？', `「${d.name}」会变回原本的名字、时间和食材。收藏和链接会保留。`, '恢复'))) return;
      await saveRec(d.id, { fav: !!rec.fav, hidden: !!rec.hidden, links: rec.links || [] }, true);
      sh.close(); render(); toast('已恢复默认');
      return;
    }
    if (e.target.closest('[data-del]')) {
      const n = S.logs.filter((l) => l.dishId === d.id).length;
      if (!(await ask('删除这道菜？', `「${d.name}」${n ? `和它的 ${n} 条做菜记录` : ''}会一起删除。`, '删除', true))) return;
      await DB.del('dishes', d.id);
      for (const l of S.logs.filter((x) => x.dishId === d.id)) await DB.del('logs', l.id);
      S.logs = S.logs.filter((x) => x.dishId !== d.id);
      for (const [date, ids] of Object.entries(S.plan)) if (ids.includes(d.id)) await setPlan(date, ids.filter((x) => x !== d.id));
      S.recs = S.recs.filter((r) => r.id !== d.id);
      refresh(); sh.close(); location.hash = '#dishes'; toast('已删除');
      return;
    }
    if (e.target.closest('[data-save]')) {
      const name = $('[name=name]', sh.el).value.trim();
      if (!name) { toast('写个菜名吧'); $('[name=name]', sh.el).focus(); return; }
      const fields = { name, en: $('[name=en]', sh.el).value.trim(), emoji: st.emoji, cuisine: st.cuisine, type: st.type, level: st.level, taste: st.taste,
        time: Math.max(1, Math.min(600, Number($('[name=time]', sh.el).value) || 30)), ings: splitIngs($('[name=ings]', sh.el).value) };
      if (d) {
        await saveRec(d.id, d.builtin ? { ...fields, edited: true } : fields);
        sh.close(); render(); toast('已保存');
      } else {
        const nid = 'u' + uid();
        const link = parseShared(($('[name=link]', sh.el) || {}).value);
        await saveRec(nid, { ...fields, custom: true, createdAt: Date.now(), links: link ? [{ ...link, title: link.title || name, addedAt: Date.now() }] : [] });
        sh.close(); location.hash = `#dish/${nid}`; toast('已添加 🎉');
      }
    }
  });
}

function linkSheet(id) {
  const d = dishById(id);
  const html = `<p class="muted sm">在小红书打开那篇笔记 → 点右上角 <b>分享</b> → <b>复制链接</b>，再回来粘贴到下面。</p>
    <button type="button" class="btn soft block" data-paste>📋 从剪贴板粘贴</button>
    <label class="field"><span>链接或分享文字</span><textarea name="text" rows="3" placeholder="http://xhslink.com/…"></textarea></label>
    <label class="field"><span>给它起个名字（可选）</span><input name="title" maxlength="60" placeholder="${esc(d.name)} · 超简单版"></label>
    <p class="lpreview muted sm"></p>`;
  const sh = sheet('保存做法链接', html, { foot: '<button class="btn ghost" data-close>取消</button><button class="btn primary grow" data-save>保存</button>' });
  const ta = $('[name=text]', sh.el);
  const ti = $('[name=title]', sh.el);
  const update = () => {
    const p = parseShared(ta.value);
    $('.lpreview', sh.el).textContent = ta.value.trim() ? (p ? `${srcIcon(p.src)} ${p.url}` : '⚠️ 没找到链接（要有 http 开头的网址）') : '';
    if (p && p.title && !ti.dataset.touched) ti.value = p.title;
  };
  ta.addEventListener('input', update);
  ti.addEventListener('input', () => { ti.dataset.touched = '1'; });
  sh.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-paste]')) {
      try { ta.value = await navigator.clipboard.readText(); update(); } catch (err) { toast('没法读取剪贴板，请长按输入框粘贴'); ta.focus(); }
      return;
    }
    if (e.target.closest('[data-save]')) {
      const p = parseShared(ta.value);
      if (!p) { toast('没找到链接'); return; }
      await saveRec(d.id, { links: [{ url: p.url, title: ti.value.trim() || p.title || d.name, src: p.src, addedAt: Date.now() }, ...d.links.filter((l) => l.url !== p.url)] });
      sh.close(); render(); toast('已保存，下次一点就打开 📌');
    }
  });
}

function chooseDish(title, top) {
  return new Promise((resolve) => {
    let picked = false;
    const list = (q) => S.dishes.filter((d) => !q || `${d.name} ${d.en || ''} ${d.ings.join(' ')}`.toLowerCase().includes(q)).slice(0, 50)
      .map((d) => `<button type="button" class="pitem" data-pick="${d.id}">${plate(d, 'sm')}<span class="grow"><b>${esc(d.name)}</b><small>${cuis(d).name} · ${typ(d).name} · ${d.time} 分钟</small></span></button>`).join('') || '<p class="muted center">没找到，可以去「菜谱」添加</p>';
    const sh = sheet(title, `${top || ''}<div class="search"><span>🔍</span><input type="search" data-q placeholder="搜菜名或食材"></div><div class="plist">${list('')}</div>`, { onClose: () => { if (!picked) resolve(null); } });
    $('[data-q]', sh.el).addEventListener('input', (e) => { $('.plist', sh.el).innerHTML = list(e.target.value.trim().toLowerCase()); });
    sh.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick],[data-special]');
      if (!b) return;
      picked = true;
      resolve(b.dataset.pick || 'special:' + b.dataset.special);
      sh.close();
    });
  });
}

async function addToShop(dishes) {
  if (!dishes.length) { toast('还没有排菜'); return; }
  const items = shoppingFrom(dishes, S.settings.withPantry);
  const r = mergeShop(S.shop, items, uid);
  await saveShop(r.list);
  render();
  toast(r.added ? `加了 ${r.added} 样到购物清单 🛒` : items.length ? '这些食材已经在清单里了' : '这道菜只用到常备调料');
}

// Slot-machine style shuffle before a result appears.
async function shuffle() {
  const el = $('#stage');
  if (!el || reduced()) return;
  S.ui.spinning = true;
  const pool = S.dishes.filter((d) => !d.hidden);
  el.innerHTML = '<div class="spinner card"><span class="plate xl spinning"><i></i></span><h2 class="sname"></h2><p class="muted sm">挑选中…</p></div><button class="btn primary huge block" disabled>🎲 挑选中…</button>';
  const p = $('.plate', el);
  const n = $('.sname', el);
  for (let i = 0; i < 14; i++) {
    const d = pool[Math.floor(Math.random() * pool.length)];
    p.style.setProperty('--c', cuis(d).color);
    p.firstChild.textContent = d.emoji;
    n.textContent = d.name;
    await sleep(35 + i * i * 0.9);
  }
  S.ui.spinning = false;
}

// ---------- actions ----------
const ACTS = {
  mode: ({ v }) => { S.ui.mode = v; render(); },
  filters: () => filterSheet(),
  async taste({ v }) {
    if (S.settings.filter.taste === v) return;
    S.settings.filter = { ...S.settings.filter, taste: v };
    await saveSettings();
    S.ui.result = null; S.ui.combo = null; S.ui.fridgePick = null; S.ui.skip = [];
    render();
    toast({ daily: '🍚 日常家常：不油炸、不重口', light: '🥗 只挑少油少盐的', heavy: '🔥 今天放纵一下！' }[v]);
  },
  async spin() {
    if (S.ui.spinning) return;
    const ui = S.ui;
    if (ui.mode === 'combo') {
      const c = pickCombo(S.dishes, pickOpts());
      if (!COMBO.some((k) => c[k])) { toast('没有符合筛选条件的菜，放宽一点试试'); return; }
      await shuffle();
      ui.combo = c;
    } else {
      if (ui.result) ui.skip.push(ui.result);
      let r = pickOne(S.dishes, pickOpts());
      if (!r && ui.skip.length) { ui.skip = []; r = pickOne(S.dishes, pickOpts()); if (r) toast('都看过一轮啦，重新开始'); }
      if (!r) { toast('没有符合筛选条件的菜，放宽一点试试'); return; }
      await shuffle();
      ui.result = r.dish.id;
      ui.relaxed = r.relaxed;
    }
    render();
  },
  async choose({ id }) {
    const t = today();
    await setPlan(t, [...(S.plan[t] || []), id]);
    S.ui.result = null; S.ui.fridgePick = null; S.ui.skip = [];
    render();
    scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    toast(`今晚就吃 ${dishById(id).name}！`);
  },
  async 'choose-combo'() {
    const t = today();
    const ids = COMBO.map((k) => S.ui.combo[k]).filter(Boolean);
    await setPlan(t, [...(S.plan[t] || []), ...ids]);
    S.ui.combo = null;
    render();
    scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    toast('今晚菜单排好了 🍱');
  },
  'combo-reroll': ({ k }) => {
    const c = S.ui.combo;
    const r = pickOne(S.dishes, { ...pickOpts(COMBO.map((x) => c[x]).filter(Boolean)), filter: { ...S.settings.filter, type: k } });
    if (!r) { toast(`没有别的${TYPES[k].name}可以换了`); return; }
    c[k] = r.dish.id;
    render();
  },
  nope({ id }) {
    const d = dishById(id);
    const sh = sheet(`不想吃「${d.name}」？`, '<div class="choices"><button class="btn soft block" data-n="skip">这次先跳过</button><button class="btn ghost block" data-n="hide">以后都别抽到它</button><p class="muted sm center">之后可以在「菜谱 → 🙈 不抽的」里改回来</p></div>', { cls: 'small' });
    sh.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-n]');
      if (!b) return;
      sh.close();
      if (b.dataset.n === 'hide') { await saveRec(id, { hidden: true }); toast('好的，以后不抽它了'); }
      S.ui.skip.push(id);
      if (S.ui.mode === 'fridge') { S.ui.fridgePick = null; ACTS['fridge-pick'](); return; }
      S.ui.result = null;
      ACTS.spin();
    });
  },
  fridge: ({ v }) => { const f = S.ui.fridge; S.ui.fridge = f.includes(v) ? f.filter((x) => x !== v) : [...f, v]; S.ui.fridgePick = null; render(); },
  'fridge-clear': () => { S.ui.fridge = []; S.ui.fridgePick = null; render(); },
  async 'fridge-pick'() {
    if (S.ui.spinning) return;
    const ms = fridgeMatches(S.dishes, S.ui.fridge, { filter: S.settings.filter });
    if (S.ui.fridgePick) S.ui.skip.push(S.ui.fridgePick);
    let d = pickFridge(ms, pickOpts());
    if (!d && S.ui.skip.length) { S.ui.skip = []; d = pickFridge(ms, pickOpts()); }
    if (!d) { toast('没有能做的菜'); return; }
    S.ui.fridgePick = d.id;
    render();
    const card = $('.result');
    if (card) card.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  },
  back: () => { if (history.length > 1) history.back(); else location.hash = '#home'; },
  async fav({ id }) { const d = dishById(id); await saveRec(id, { fav: !d.fav }); render(); toast(d.fav ? '已取消收藏' : '已收藏 ❤️ 抽到它的机会更大'); },
  async hide({ id }) { const d = dishById(id); await saveRec(id, { hidden: !d.hidden }); render(); toast(d.hidden ? '好的，又可以抽到它了' : '以后不会抽到它'); },
  'to-plan': ({ id }) => {
    const d = dishById(id);
    const t = today();
    const days = Array.from({ length: 7 }, (_, i) => addDays(t, i));
    const sh = sheet(`哪天吃「${d.name}」？`, `<div class="daypick">${days.map((x, i) => `<button type="button" class="btn ${i ? 'ghost' : 'primary'}" data-d="${x}">${i === 0 ? '今天' : i === 1 ? '明天' : weekday(x)} <small>${fmtDate(x, false)}</small>${(S.plan[x] || []).length ? `<em>已排 ${(S.plan[x] || []).length}</em>` : ''}</button>`).join('')}</div>`, { cls: 'small' });
    sh.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      await setPlan(b.dataset.d, [...(S.plan[b.dataset.d] || []), id]);
      sh.close(); render(); toast(`已加入 ${fmtDate(b.dataset.d)} 的菜单`);
    });
  },
  'shop-dishes': ({ ids }) => addToShop(ids.split(',').map(dishById).filter(Boolean)),
  'link-add': ({ id }) => linkSheet(id),
  async 'link-del'({ id, i }) {
    const d = dishById(id);
    if (!(await ask('删除这个链接？', d.links[i].title || d.links[i].url, '删除', true))) return;
    await saveRec(id, { links: d.links.filter((_, k) => k !== Number(i)) });
    render();
  },
  'log-new': ({ id }) => logSheet(id),
  'log-edit': ({ id }) => logSheet(null, id),
  'edit-dish': ({ id }) => dishForm(id),
  'dish-new': () => dishForm(null),
  'lib-chip': ({ v }) => { S.ui.lib.chip = v; render(); },
  week: ({ v }) => { S.ui.week = addDays(S.ui.week || weekStart(today()), Number(v) * 7); render(); },
  async 'fill-week'() {
    const dates = weekDates(S.ui.week || weekStart(today()));
    const add = fillWeek(S.dishes, S.plan, dates, { ...pickOpts(), skip: [] });
    const n = Object.keys(add).length;
    if (!n) { toast(dates[6] < today() ? '这周已经过去了' : '这周都排好了'); return; }
    for (const [date, ids] of Object.entries(add)) await setPlan(date, ids);
    render(); toast(`帮你排了 ${n} 天 🎲 不喜欢可以点 ✕ 换掉`);
  },
  'shop-week': () => {
    const t = today();
    const dates = weekDates(S.ui.week || weekStart(t)).filter((d) => d >= t);
    return addToShop(dates.flatMap((d) => S.plan[d] || []).map(dishById).filter(Boolean));
  },
  async 'plan-add'({ date }) {
    const top = '<div class="btns two"><button type="button" class="btn soft" data-special="one">🎲 随机一道</button><button type="button" class="btn soft" data-special="combo">🍱 两菜一汤</button></div>';
    const r = await chooseDish(`${fmtDate(date)} 吃什么`, top);
    if (!r) return;
    const ids = [...(S.plan[date] || [])];
    const o = pickOpts(weekDates(weekStart(date)).flatMap((d) => S.plan[d] || []));
    if (r === 'special:one') { const p = pickOne(S.dishes, o); if (p) ids.push(p.dish.id); } else if (r === 'special:combo') { const c = pickCombo(S.dishes, o); ids.push(...COMBO.map((k) => c[k]).filter(Boolean)); } else ids.push(r);
    await setPlan(date, ids);
    render();
  },
  async 'plan-rm'({ date, id }) { await setPlan(date, (S.plan[date] || []).filter((x) => x !== id)); render(); },
  async 'shop-toggle'({ id }) { await saveShop(S.shop.map((x) => (x.id === id ? { ...x, done: !x.done } : x))); render(); },
  async 'shop-del'({ id }) { await saveShop(S.shop.filter((x) => x.id !== id)); render(); },
  async 'shop-clear'() { await saveShop(S.shop.filter((x) => !x.done)); render(); toast('已清除'); },
  month: ({ v }) => { S.ui.month = addMonths(S.ui.month || today().slice(0, 7), Number(v)); render(); },
  day: ({ date }) => {
    const ls = S.logs.filter((l) => l.date === date).sort(byDateDesc);
    const sh = sheet(fmtDate(date), `${ls.map((l) => logRow(l)).join('')}<button type="button" class="btn soft block" data-more>＋ 补记一道</button>`);
    sh.el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act]')) { sh.close(); return; }
      if (!e.target.closest('[data-more]')) return;
      sh.close();
      const id = await chooseDish('补记哪道菜？');
      if (id && !id.startsWith('special:')) logSheet(id, null, date);
    });
  },
  'logs-all': () => { S.ui.allLogs = true; render(); },
  async 'install-hide'() { S.settings.hideInstall = true; await saveSettings(); render(); },
  async export() {
    const data = await DB.dump();
    const name = `今晚吃啥备份-${today()}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== 'AbortError') throw e; }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('备份已下载');
  },
  async import() {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { toast('这个文件读不了'); return; }
    if (!data || data.app !== 'dinner') { toast('这不是「今晚吃啥」的备份文件'); return; }
    if (!(await ask('导入备份？', `备份里有 ${(data.logs || []).length} 条记录、${(data.dishes || []).filter((d) => d.custom).length} 道自己加的菜。会合并到现在的资料里。`, '导入'))) return;
    await DB.restore(data, 'merge');
    await load(); render(); toast('导入好了 ✓');
  },
  async wipe() {
    if (!(await ask('清空所有资料？', '记录、菜单、购物清单、自己加的菜和收藏都会删掉，没法恢复。建议先导出备份。', '全部清空', true))) return;
    await DB.wipe();
    S.ui.result = null; S.ui.combo = null;
    await load(); location.hash = '#home'; render(); toast('已清空');
  },
};

// ---------- routing ----------
const SCREENS = { home: Home, dishes: Dishes, dish: DishPage, plan: Plan, log: LogPage, me: Me };
let lastRoute = '';
function render() {
  const [name, arg] = (location.hash.slice(1) || 'home').split('/');
  const fn = SCREENS[name] || Home;
  const route = location.hash;
  const y = route === lastRoute ? scrollY : 0;
  lastRoute = route;
  $('#view').innerHTML = fn(arg ? decodeURIComponent(arg) : arg);
  const tab = { dish: 'dishes', me: 'home' }[name] || (SCREENS[name] ? name : 'home');
  $$('.tabs [data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  scrollTo(0, y);
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el.dataset, el); } catch (err) { console.error(err); toast('出错了：' + (err.message || err)); }
});
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-act]')) { e.preventDefault(); e.target.click(); } });
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-lib-q]')) { S.ui.lib.q = e.target.value; $('#grid').innerHTML = libGrid(); }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('[data-lib-sel]')) { S.ui.lib[el.dataset.libSel] = el.value; $('#grid').innerHTML = libGrid(); return; }
  if (el.matches('[data-set]')) {
    const k = el.dataset.set;
    S.settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, Math.min(60, Math.round(Number(el.value) || 0))) : el.value;
    if (el.type === 'number') el.value = S.settings[k];
    await saveSettings();
    toast('已保存');
  }
});
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'shop-add') {
    const names = splitIngs(form.item.value);
    if (!names.length) return;
    const r = mergeShop(S.shop, names.map((name) => ({ name, for: [] })), uid);
    await saveShop(r.list);
    render();
    const inp = $('[data-form=shop-add] [name=item]');
    if (inp) inp.focus();
  }
});
window.addEventListener('hashchange', render);
// No zooming: double-tap is off via touch-action in app.css; iOS ignores user-scalable=no, so pinch is stopped here.
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  checkUpdate();
  if (!$('.sheet-wrap') && !S.ui.spinning && !(document.activeElement && document.activeElement.matches('input,textarea,select'))) render(); // the date may have changed
});

async function start() {
  try { await load(); } catch (e) { $('#view').innerHTML = `<div class="empty">无法打开本地资料库：${esc(e.message)}<br>如果在无痕模式，请换普通模式打开。</div>`; return; }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(() => checkUpdate()).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      reloadWhenIdle();
    });
  }
  window.__dinner = { S, render, DB, reload: async () => { await load(); render(); } }; // for tests
  document.documentElement.dataset.ready = '1';
}

// ---------- updates ----------
// Every open asks for the latest sw.js; a new version installs in the background, takes over and the page reloads into it.
let hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
let lastCheck = 0;
async function checkUpdate() {
  if (!('serviceWorker' in navigator) || Date.now() - lastCheck < 10000) return;
  lastCheck = Date.now();
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* offline */ }
}
function reloadWhenIdle() {
  if (reloadWhenIdle.done) return;
  if ($('.sheet-wrap')) { setTimeout(reloadWhenIdle, 1500); return; } // don't lose a form being filled in
  reloadWhenIdle.done = true;
  try { sessionStorage.setItem('dinner-updated', '1'); } catch (e) { /* ignore */ }
  location.reload();
}
try { if (sessionStorage.getItem('dinner-updated')) { sessionStorage.removeItem('dinner-updated'); setTimeout(() => toast(`已更新到最新版 v${VERSION} ✨`), 600); } } catch (e) { /* ignore */ }
start();
