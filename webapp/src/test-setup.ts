import { afterEach } from 'vitest';

// The jsdom environment is given a real origin (vite.config.ts) so window.localStorage exists.
// Node's experimental global `localStorage` (which needs --localstorage-file) can still shadow it,
// so make the bare `localStorage` reference resolve to jsdom's window storage, and guarantee it is
// a working Storage even on a jsdom build that omits it. Persistence code then runs for real in
// tests instead of every test hand-stubbing localStorage.
function ensureLocalStorage(): void {
  const win = globalThis as unknown as {
    window?: { localStorage?: Storage };
    localStorage?: Storage;
  };
  let storage = win.window?.localStorage;
  if (!storage) {
    const map = new Map<string, string>();
    storage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    } as Storage;
    if (win.window) win.window.localStorage = storage;
  }
  // Point the bare global `localStorage` at the same object jsdom's window uses.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

ensureLocalStorage();

// Isolate storage between tests so a persisted preference never leaks across the file.
afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
