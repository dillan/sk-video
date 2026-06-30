/*
 * SK Video service worker — an app-shell cache only.
 *
 * Scope is the app mount (/plugins/sk-video/app/), so the worker only ever sees the app's own
 * requests — never the plugin API or the video streams, which live at the parent path. That is the
 * honest boundary: the shell (HTML/JS/CSS/icon) works offline once visited, but live video and fresh
 * lists ALWAYS hit the network, because stale safety/operational data must never be served from cache.
 *
 * Caching is runtime, not a precomputed precache manifest, so it survives hashed-asset renames across
 * deploys without a build plugin: navigations are network-first (fall back to the cached shell when
 * offline); static assets are cache-first and populated on first fetch.
 */
const CACHE = 'sk-video-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(url) {
  return /\.(?:js|mjs|css|svg|png|jpg|jpeg|webp|avif|ico|woff2?|ttf|webmanifest)$/.test(
    url.pathname,
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations: network-first so a fresh shell is preferred, cached shell only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(
        () =>
          caches.match('./index.html', { ignoreSearch: true }).then((r) => r || caches.match('./')),
      ),
    );
    return;
  }

  // Static hashed assets: cache-first, populate on first fetch.
  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
  // Everything else falls through to the network untouched.
});

// A safety/security push arrived — render it. The payload is the JSON the plugin sent.
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      /* malformed payload — fall back to the generic title below */
    }
  }
  const title = data.title || 'SK Video';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag, // same-tag pushes collapse on the device
      renotify: Boolean(data.tag),
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: typeof data.url === 'string' ? data.url : '#/' },
    }),
  );
});

// Tapping the notification focuses an existing app window (deep-linking to the relevant screen) or
// opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.url) || '#/';
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.includes('/plugins/sk-video/app/')) {
          await client.focus();
          try {
            await client.navigate(client.url.split('#')[0] + hash);
          } catch {
            /* navigation is best-effort; focusing is what matters */
          }
          return;
        }
      }
      await self.clients.openWindow('./' + hash);
    })(),
  );
});
