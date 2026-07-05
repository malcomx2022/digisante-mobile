/* ─────────────────────────────────────────────────────────────
   DigiSanté Mobile — Service Worker (offline-first, CLAUDE.md §3).
   App shell + motifs CSS en cache ; API (données de santé) JAMAIS en cache.
   ───────────────────────────────────────────────────────────── */
const VERSION = 'v2';
const APP_SHELL = `digisante-shell-${VERSION}`;
const RUNTIME = `digisante-runtime-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/manifest.json', '/icon.svg', '/icon-maskable.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![APP_SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // ne jamais intercepter les mutations

  const url = new URL(request.url);

  // API / données de santé : réseau seul, JAMAIS en cache (confidentialité §4).
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/v1/')) return;

  // Navigation : network-first → cache '/' → page hors-ligne.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((r) => r || caches.match('/offline.html'))),
    );
    return;
  }

  // Statiques same-origin (app shell, motifs, polices) : stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((resp) => {
            if (resp && resp.ok) cache.put(request, resp.clone());
            return resp;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
