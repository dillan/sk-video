import { useEffect, useState } from 'react';

/**
 * Minimal hash router. Hash routing (not history) is deliberate: the app is served under
 * /plugins/sk-video/app/ and the server has no deep-path fallback, so client routes live after the #.
 * A route is a cluster plus an optional id (e.g. the focused camera: `#/live/foredeck`).
 *
 * Deep-link contract (v1): entity links are ALIASES that land on the right cluster/tab —
 * `#/recordings/:id?t=` and `#/incidents/:id` open the matching Review tab (the entity id and
 * timestamp are dropped; those screens select internally), and `#/cameras/:id/calibrate` opens the
 * Cameras cluster (trailing action segments are ignored). Anything unknown falls back to Live.
 */
export type Cluster = 'live' | 'review' | 'cameras' | 'safety' | 'settings';
const CLUSTERS: readonly Cluster[] = ['live', 'review', 'cameras', 'safety', 'settings'];
/** Entity heads that alias to a Review tab: `#/recordings/…` → `#/review/recordings`, etc. */
const REVIEW_TAB_ALIASES: readonly string[] = ['recordings', 'incidents'];

export interface IRoute {
  cluster: Cluster;
  id?: string;
}

export function parseRoute(hash: string): IRoute {
  const segs = hash.replace(/^#\/?/, '').split('/');
  const head = segs[0]?.split('?')[0] ?? '';
  if (REVIEW_TAB_ALIASES.includes(head)) {
    return { cluster: 'review', id: head };
  }
  const cluster = (CLUSTERS as readonly string[]).includes(head) ? (head as Cluster) : 'live';
  const rawId = segs[1]?.split('?')[0] ?? '';
  let id: string | undefined;
  if (rawId) {
    try {
      id = decodeURIComponent(rawId);
    } catch {
      id = undefined;
    }
  }
  return { cluster, id };
}

export function toHash(cluster: Cluster, id?: string): string {
  return id ? `#/${cluster}/${encodeURIComponent(id)}` : `#/${cluster}`;
}

export function useHashRoute(): [IRoute, (cluster: Cluster, id?: string) => void] {
  const [route, setRoute] = useState<IRoute>(() =>
    parseRoute(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  useEffect(() => {
    const onHash = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (cluster: Cluster, id?: string): void => {
    window.location.hash = toHash(cluster, id);
  };
  return [route, navigate];
}
