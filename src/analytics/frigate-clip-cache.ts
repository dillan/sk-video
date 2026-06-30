import { AssetQuotaError, type AssetStore } from '../uploads/asset-store';

/**
 * Caches a Frigate clip, evicting the OLDEST cached clips to make room when the store's quota is hit
 * — so the clip cache is a rolling buffer, not a one-shot that silently freezes once full. A clip
 * that is rejected for any non-quota reason (bad magic bytes) is simply not cached (returns null),
 * without evicting anything. Returns the stored asset id, or null if it could not be cached.
 */
export function cacheFrigateClip(
  store: AssetStore,
  bytes: Uint8Array,
  name: string,
): string | null {
  try {
    return store.add(bytes, name).id;
  } catch (err) {
    if (!(err instanceof AssetQuotaError)) {
      return null; // not a valid clip (e.g. bad type) — don't evict the cache for that
    }
  }
  // Over quota: evict oldest-first until the new clip fits (bounded by the cached clip count).
  const oldestFirst = [...store.list()].sort((a, b) => a.createdAt - b.createdAt);
  for (const old of oldestFirst) {
    store.delete(old.id);
    try {
      return store.add(bytes, name).id;
    } catch (err) {
      if (!(err instanceof AssetQuotaError)) {
        return null;
      }
    }
  }
  return null; // could not fit even after evicting everything (clip larger than the whole budget)
}
