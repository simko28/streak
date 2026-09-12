/* Offline shell for Streak.
   Strategy is stale-while-revalidate: the phone paints from cache instantly,
   the network copy replaces it in the background, and the next launch is current.
   Bump V when you deploy and want the update to land on the very next open. */
const V = 'streak-v17';
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

/* ---------- push ----------
   The push that arrives carries no body: it is only a doorbell. What to say is
   read here, on the device, out of the same IndexedDB the app writes to. The
   server never sees a habit name — it only knows this device asked for a nudge
   at some o'clock. */
const plan = () => new Promise(res => {
  let done = false;
  const give = v => { if (!done){ done = true; res(v); } };
  setTimeout(() => give(null), 2000);
  try {
    const r = indexedDB.open('habits-store', 1);
    r.onerror = () => give(null);
    r.onsuccess = () => {
      try {
        const q = r.result.transaction('kv', 'readonly').objectStore('kv').get('push:plan');
        q.onsuccess = () => { try { give(JSON.parse(q.result)); } catch (e) { give(null); } };
        q.onerror = () => give(null);
      } catch (e) { give(null); }
    };
  } catch (e) { give(null); }
});

const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  + '-' + String(d.getDate()).padStart(2, '0');

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const p = await plan();
    const now = new Date(), today = ymd(now), mins = now.getHours() * 60 + now.getMinutes();
    let due = [];
    if (p && Array.isArray(p.items)){
      // anything scheduled within the last half hour, minus what is already done
      const fresh = p.doneDate === today ? (p.done || []) : [];
      due = p.items.filter(it => {
        if (fresh.includes(it.id)) return false;
        if (Array.isArray(it.days) && it.days.length && !it.days.includes(now.getDay())) return false;
        const [h, m] = String(it.at).split(':').map(Number);
        const delta = mins - (h * 60 + m);
        return delta >= 0 && delta <= 30;
      });
    }
    const title = !due.length ? 'Streak'
      : due.length === 1 ? due[0].name
      : due.length + ' habits waiting';
    const body = !due.length ? 'Time to check in.'
      : due.length === 1 ? (due[0].q || 'Time for this one.')
      : due.map(d => d.name).join(' · ');
    await self.registration.showNotification(title, {
      body, icon: './icon-192.png', badge: './icon-192.png',
      tag: 'streak-reminder', renotify: true,
      data: { url: './' }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (c.url.includes(self.registration.scope)) return c.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  })());
});
