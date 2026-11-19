# 今晚吃啥 (What's for dinner)

An iPhone home-screen web app (PWA) that picks dinner for you, opens the recipe search on 小红书,
and keeps a record of what you cooked with notes for next time. Everything is stored on the phone (IndexedDB);
backups are JSON files you export from Settings.

## Features
- **今晚**: 🎲 pick one dish · 🍱 两菜一汤 (meat + vegetable + soup, reroll each) · 🧊 冰箱有啥 (tap what you have, see what you can cook and what's missing).
  口味 row: 日常家常 (default: no fried / strong food) · 少油少盐 · 油炸重口 (in 两菜一汤 only the meat dish is the treat).
  Default difficulty is 新手友好; light dishes come up a bit more often. Filters: cuisine, type, time, difficulty, favourites only. Dishes cooked in the last N days are skipped; favourites and
  well-rated dishes come up more often, badly rated ones less. "不想吃这个" skips once or hides a dish for good.
- **小红书**: every dish has a 📕 button that opens the 小红书 app on a search for "<dish> 做法". Paste a note's share
  link onto a dish to keep the exact recipe you liked (📌).
- **Records**: 做好了 → date, ★ rating, notes (with quick chips like 下次多放盐), photo. The latest note shows up the next
  time the dish is picked. Calendar, streak, most-cooked list.
- **菜单**: plan the week (random fill or pick), generate a shopping list from it, tick items off.
- **菜谱**: ~140 built-in dishes, each tagged 清淡 / 家常 / 重口 (Chinese, Malaysian, Japanese/Korean, Western, Thai/Vietnamese); add your own or edit any.

## Files
- `index.html`, `app.css`, `js/app.js` (UI), `js/logic.js` (pure logic), `js/dishes.js` (library), `js/db.js` (storage), `sw.js` (offline + auto-update)
- `tools/make-icons.py` draws the icons. `test/` has the tests.

## Run & test
- Local: `node test/server.js` → http://localhost:8795/
- Tests: `npm test` (logic, headless-Chrome UI test, layout test at 320–430 px)
- Publish: `.\deploy.ps1 "what changed"` (runs the tests first; bump VERSION in `sw.js` and `js/app.js`)
