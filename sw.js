/* Offline shell for Streak.
   Strategy is stale-while-revalidate: the phone paints from cache instantly,
   the network copy replaces it in the background, and the next launch is current.
   Bump V when you deploy and want the update to land on the very next open. */
const V = 'streak-v8';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    // one bad URL should not fail the whole install
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).origin !== self.location.origin) return;   // nothing external to cache
  e.respondWith((async () => {
    const cache = await caches.open(V);
    const hit = await cache.match(r, { ignoreSearch: true });
    const net = fetch(r).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(r, res.clone());
      return res;
    }).catch(() => null);
    if (hit){ e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (r.mode === 'navigate'){
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
