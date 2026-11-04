// Generated asset list and cache version are inserted during `npm run build:web`.
const BASE = new URL(self.registration.scope);
const CACHE_NAME = __CACHE_NAME__;
const PRE_CACHE = __PRE_CACHE__;
const INDEX = new URL('./index.html', BASE).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRE_CACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pocket-ledger-app-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(INDEX)));
    return;
  }
  // Only application build files are cached; no third-party requests or financial data.
  if (!PRE_CACHE.includes(url.href)) return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
