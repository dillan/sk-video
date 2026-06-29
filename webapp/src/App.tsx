import { useEffect, useState } from 'react';
import {
  describeAuth,
  fetchSession,
  fetchStatus,
  type IPluginStatus,
  type ISessionInfo,
} from './api';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; status: IPluginStatus }
  | { state: 'error'; message: string };

/**
 * Scaffold shell for the SK Video operator console. It proves the same-origin contract end to end
 * (built bundle → served under /plugins/sk-video/app → calls GET /status on the parent path) and
 * gives the design work a themed frame to grow into. The real screens (Live Wall, Camera Focus,
 * Review, etc.) land here behind routing in later phases.
 */
export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [session, setSession] = useState<ISessionInfo | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchStatus(ctrl.signal)
      .then((status) => setLoad({ state: 'ready', status }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) {
          return;
        }
        setLoad({
          state: 'error',
          message: err instanceof Error ? err.message : 'unreachable',
        });
      });
    // The session probe is best-effort: a failure just leaves the chip in its "checking…" state.
    fetchSession(ctrl.signal)
      .then((info) => setSession(info))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>SK Video</h1>
        <p className="tagline">Marine video — live, recorded, and as a safety instrument.</p>
        <span className="auth-chip" data-secured={session?.securityEnabled ? 'true' : 'false'}>
          {describeAuth(session)}
        </span>
      </header>

      <section className="card" aria-live="polite">
        {load.state === 'loading' && <p className="muted">Connecting to the plugin…</p>}
        {load.state === 'error' && (
          <p className="status-bad">Can’t reach SK Video ({load.message}).</p>
        )}
        {load.state === 'ready' && (
          <dl className="status-grid">
            <dt>Status</dt>
            <dd>{load.status.ready ? 'ready' : 'starting…'}</dd>
            <dt>Cameras</dt>
            <dd>{typeof load.status.cameras === 'number' ? load.status.cameras : '—'}</dd>
            <dt>Hardware tier</dt>
            <dd>{load.status.hardware?.tier ?? 'unknown'}</dd>
          </dl>
        )}
      </section>

      <footer className="app-footer muted">Scaffold — the operator console UI lands here.</footer>
    </main>
  );
}
