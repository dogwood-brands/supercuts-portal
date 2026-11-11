// SC Portal service worker.
// Strategy: the API and uploads are never cached (always live, always behind the session).
// The app shell is network-first with a cached fallback, so a new release shows up on the next load
// and the app still opens with a weak signal. Fonts and media are cache-first.

const VERSION = 'scp-v1-4';
const SHELL = ['/', '/css/tokens.css', '/css/base.css', '/css/components.css', '/css/shell.css', '/js/app.js',
  '/fonts/red-hat-display.woff2', '/fonts/red-hat-text.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname === '/healthz') return;

  const cacheFirst = url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/media/');
  if (cacheFirst) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((cache) => cache.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});
