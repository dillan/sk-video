import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The service worker is plain runtime JS (webapp/public/sw.js), so it never passes through the
// bundler or the component tests. Evaluate it in a mocked SW global and dispatch synthetic events:
// the fetch handler's scope discipline is safety-critical (a cache-first hit on a live frame would
// replay a stale image labelled LIVE), so it gets pinned here rather than trusted by review.
// (vitest runs with cwd = webapp/, so public/sw.js resolves from there.)
const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

const SCOPE = 'http://sk.local/plugins/sk-video/app/';

interface IFetchEvent {
  request: { method: string; url: string; mode: string };
  respondWith: ReturnType<typeof vi.fn>;
  waitUntil: ReturnType<typeof vi.fn>;
}

function bootSw() {
  const listeners = new Map<string, (event: unknown) => void>();
  const cache = {
    addAll: vi.fn(async () => undefined),
    add: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    match: vi.fn(async () => undefined),
  };
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    clone: () => ({ ok: true }),
    text: async () => '',
  }));
  const self = {
    addEventListener: (name: string, cb: (event: unknown) => void) => listeners.set(name, cb),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
    registration: { scope: SCOPE, showNotification: vi.fn() },
    location: { origin: new URL(SCOPE).origin },
  };
  new Function('self', 'caches', 'fetch', SW_SOURCE)(self, caches, fetchMock);
  const dispatchFetch = (url: string, mode = 'no-cors'): IFetchEvent => {
    const event: IFetchEvent = {
      request: { method: 'GET', url, mode },
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    };
    listeners.get('fetch')?.(event);
    return event;
  };
  return { listeners, cache, caches, fetchMock, self, dispatchFetch };
}

describe('sw.js fetch handler', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('never intercepts live camera frames outside the app mount', () => {
    const { dispatchFetch } = bootSw();
    // A controlled page's subresource fetches dispatch fetch events for ANY url — the registration
    // scope does not filter them. A cache hit here would replay a stale frame labelled LIVE.
    const event = dispatchFetch('http://sk.local/plugins/sk-video/cameras/bow/frame.jpeg?t=3');
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it('never intercepts snapshot blobs or other API media outside the app mount', () => {
    const { dispatchFetch } = bootSw();
    const event = dispatchFetch('http://sk.local/plugins/sk-video/snapshots/snap-1.jpg');
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it('serves in-scope hashed assets cache-first', () => {
    const { dispatchFetch } = bootSw();
    const event = dispatchFetch(`${SCOPE}assets/index-abc123.js`);
    expect(event.respondWith).toHaveBeenCalledTimes(1);
  });

  it('handles navigations network-first', () => {
    const { dispatchFetch, fetchMock } = bootSw();
    const event = dispatchFetch(`${SCOPE}`, 'navigate');
    expect(event.respondWith).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('ignores non-GET requests', () => {
    const { listeners } = bootSw();
    const event = {
      request: { method: 'POST', url: `${SCOPE}assets/x.js`, mode: 'cors' },
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    };
    listeners.get('fetch')?.(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });
});

describe('sw.js install precache', () => {
  it('precaches the shell and the hashed assets referenced by index.html', async () => {
    const { listeners, cache, fetchMock } = bootSw();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ ok: true }),
      text: async () =>
        '<html><head><script type="module" src="./assets/index-abc123.js"></script>' +
        '<link rel="stylesheet" href="./assets/index-def456.css"></head></html>',
    } as never);
    let installed: Promise<unknown> | undefined;
    listeners.get('install')?.({ waitUntil: (p: Promise<unknown>) => (installed = p) });
    await installed;
    const precached = cache.addAll.mock.calls.flat(2) as string[];
    expect(precached).toContain('./index.html');
    expect(precached).toContain('./assets/index-abc123.js');
    expect(precached).toContain('./assets/index-def456.css');
  });
});
