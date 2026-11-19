// Toolbox service worker: precache the shell, serve same-origin GETs cache-first.
// Bump VERSION whenever shell files change so clients pick up the new files.
const VERSION = 'toolbox-v12';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'tools.json',
  'icons/icon-192.png', 'icons/icon-512.png',
  'core/app.js', 'core/theme.css', 'core/theme.js', 'core/router.js', 'core/ui.js',
  'core/i18n.js', 'core/store.js', 'core/model.js', 'core/months.js', 'core/money.js',
  'core/merge.js', 'core/validate.js', 'core/crypto.js', 'core/backup.js', 'core/sync.js',
  'core/autosync.js', 'core/settings-view.js', 'core/feedback.js', 'core/feedback-view.js', 'core/version.js', 'core/whatsnew-view.js', 'onboarding/welcome.js',
  'core/locales/ar.json', 'core/locales/en.json',
  'tools/expenses/calc.js', 'tools/expenses/installments.js',
  'tools/expenses/view.js', 'tools/expenses/expenses.css',
  'fonts/alexandria.css',
  'fonts/alexandria-arabic-400-normal.woff2', 'fonts/alexandria-arabic-600-normal.woff2', 'fonts/alexandria-arabic-700-normal.woff2',
  'fonts/alexandria-latin-400-normal.woff2', 'fonts/alexandria-latin-600-normal.woff2', 'fonts/alexandria-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' bypasses the browser HTTP cache, so an update never mixes old and new files.
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com') return; // always network, never cached
  if (url.origin !== self.location.origin) return; // other origins go to the network
  e.respondWith(
    caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error()))),
  );
});
