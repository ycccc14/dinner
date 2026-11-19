// Offline cache for the app shell. Bump VERSION whenever any file changes (and VERSION in js/app.js): the app
// checks for a new sw.js every time it opens, installs it in the background and reloads into the new version.
const VERSION = 'dinner-v1.1.0';
const FILES = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'js/app.js', 'js/db.js', 'js/logic.js', 'js/dishes.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never mixes in old files.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
    e.respondWith(caches.open(VERSION).then((c) => c.match('index.html')).then((r) => r || fetch(e.request)));
    return;
  }
  e.respondWith(caches.open(VERSION).then((c) => c.match(e.request, { ignoreSearch: true })).then((r) => r || fetch(e.request)));
});
