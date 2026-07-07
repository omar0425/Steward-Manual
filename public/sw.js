'use strict';

/* Steward service worker — installability + payment-reminder push.
   Deliberately thin: the server already sets the right Cache-Control (fonts
   immutable, everything else revalidates), so the only asset cache here is a
   safety net for fonts. API requests are never cached — money data must
   always be live. */

const FONT_CACHE = 'steward-fonts-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop old cache generations if the name ever changes.
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('steward-') && n !== FONT_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Fonts: cache-first (they're immutable and named by family+weight).
  if (url.pathname.startsWith('/fonts/')) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })());
  }
  // Everything else: straight to network (default behavior, handler exists so
  // the app counts as installable everywhere).
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { /* text payloads ignored */ }
  const title = data.title || 'Steward';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || 'steward',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) { await client.focus(); return; }
    }
    await self.clients.openWindow(target);
  })());
});
