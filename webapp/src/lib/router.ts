import { useEffect, useState } from 'react';

/**
 * Minimal hash router. Hash routing (not history) is deliberate: the app is served under
 * /plugins/sk-video/app/ and the server has no deep-path fallback, so client routes live after the #.
 */
export type Route = 'live' | 'review' | 'cameras' | 'safety';
const ROUTES: readonly Route[] = ['live', 'review', 'cameras', 'safety'];

export function routeFromHash(hash: string): Route {
  const seg = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (ROUTES as readonly string[]).includes(seg) ? (seg as Route) : 'live';
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() =>
    routeFromHash(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  useEffect(() => {
    const onHash = (): void => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (r: Route): void => {
    window.location.hash = `#/${r}`;
  };
  return [route, navigate];
}
