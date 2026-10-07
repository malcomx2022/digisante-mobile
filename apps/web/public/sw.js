/* Shell public seulement ; données médicales sous le coffre IndexedDB, jamais CacheStorage. */
const VERSION = 'v3';
const APP_SHELL = `digisante-shell-${VERSION}`;
const RUNTIME = `digisante-runtime-${VERSION}`;
const NAVIGATIONS = ['/', '/patient/offline', '/patient/triage'];
const PRECACHE = [...NAVIGATIONS, '/offline.html', '/manifest.json', '/icon.svg', '/icon-maskable.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'];
const staticAsset = (url) => url.origin === self.location.origin && (url.pathname.startsWith('/_next/static/') || /^\/(icon[^/]*\.(png|svg)|apple-touch-icon\.png|manifest\.json)$/.test(url.pathname));
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL);
    await cache.addAll(PRECACHE);
    // Les HTML précachés sont des coquilles client sans données médicales.
    // Charger leurs scripts/styles pour qu'un rechargement hors réseau fonctionne.
    for (const path of NAVIGATIONS) {
      const response = await cache.match(path); const html = await response.text();
      const urls = [...html.matchAll(/(?:src|href)="([^"<>]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), self.location.origin)).filter(staticAsset);
      await cache.addAll([...new Set(urls.map((u) => u.href))]);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('digisante-') && ![APP_SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const { request } = event; if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.headers.get('RSC') || url.searchParams.has('_rsc')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (NAVIGATIONS.includes(url.pathname) ? await caches.match(url.pathname) : null) || await caches.match('/offline.html')));
    return;
  }
  if (!staticAsset(url)) return; // aucune réponse arbitraire, fichier médical ou jeton
  const network = caches.open(RUNTIME).then(async (cache) => {
    const response = await fetch(request); if (response.ok) await cache.put(request, response.clone()); return response;
  }).catch(() => caches.match(request));
  event.waitUntil(network.then(() => undefined));
  event.respondWith(caches.match(request).then((cached) => cached || network));
});
