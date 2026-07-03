/**
 * Registers the app-shell service worker, best-effort. The worker is served at `sw.js` relative to
 * the app mount, so it only controls the app's pages — but a controlled page's fetches to ANY url
 * still dispatch through it, so sw.js itself enforces that only in-scope shell assets are ever
 * cached (the plugin API and video streams must always hit the network). A registration failure is
 * swallowed: the PWA shell is an enhancement, never a requirement for the console to work.
 */
export function registerServiceWorker(nav: Navigator = navigator): void {
  if (!('serviceWorker' in nav)) return;
  // A service worker needs a secure context; localhost counts, so dev + LAN-over-TLS both work.
  if (typeof window !== 'undefined' && window.isSecureContext === false) return;
  window.addEventListener('load', () => {
    void nav.serviceWorker.register('sw.js').catch(() => undefined);
  });
}
