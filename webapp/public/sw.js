/*
 * SK Video service worker — an app-shell cache only.
 *
 * IMPORTANT: the registration scope (/plugins/sk-video/app/) limits which PAGES this worker
 * controls, not which fetches it sees — a controlled page's subresource requests to ANY url
 * (live frame.jpeg refreshes, snapshot blobs, API calls at the parent path) all dispatch fetch
 * events here. The fetch handler must therefore enforce the boundary itself: only requests whose
 * path is inside the app mount are ever answered from cache. Live video and fresh lists ALWAYS
 * fall through to the network, because stale safety/operational data must never replay from cache
 * (a cached frame.jpeg would render as a stale image labelled LIVE).
 *
 * Precache: install fetches index.html and pulls the hashed asset urls out of it, so offline
 * cold-launch works from the first visit (runtime cache-first still backfills anything missed).
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

// The app mount's pathname (e.g. /plugins/sk-video/app/) — the only subtree we may serve from cache.
const SCOPE_PATH = new URL(self.registration.scope).pathname;

/** Hashed bundle urls referenced by the shell, so first-visit installs are offline-complete. */
async function shellAssetUrls() {
  try {
    const res = await fetch('./index.html');
    if (!res.ok) return [];
    const html = await res.text();
    const urls = [];
    const attr = /(?:src|href)="(\.\/assets\/[^"]+)"/g;
    let m;
    while ((m = attr.exec(html)) !== null) {
      urls.push(m[1]);
    }
    return urls;
  } catch {
    return []; // offline install — runtime caching backfills later
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([caches.open(CACHE), shellAssetUrls()])
      .then(([cache, assets]) => cache.addAll(SHELL.concat(assets)))
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

  // The honest boundary: anything outside the app mount — the plugin API, live frames, snapshot
  // blobs, recordings — is never intercepted, never cached. Falling through means the browser
  // fetches it from the network exactly as if no worker existed.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

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
