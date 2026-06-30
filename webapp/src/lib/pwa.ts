/**
 * Registers the app-shell service worker, best-effort. The worker is served at `sw.js` relative to
 * the app mount, so its scope is the app itself — it never intercepts the plugin API or video streams
 * (those live at the parent path and must always hit the network). A registration failure is
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
