import { useEffect, useMemo, useState } from 'react';
import { fetchSnapshots, snapshotUrl, type ISnapshot } from '../api';
import { formatLatLon } from '../lib/format';

/**
 * The Review cluster's Snapshots tab: a gallery of telemetry-stamped stills (the capture primitive MOB,
 * anchor-watch and incidents reuse). Honest about the position stamp — when there was no GPS fix it
 * says so rather than guessing — and about retention (a bounded library, oldest pruned).
 */
export function Snapshots() {
  const [snaps, setSnaps] = useState<ISnapshot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [camera, setCamera] = useState<string | null>(null);

  const cameras = useMemo(() => [...new Set((snaps ?? []).map((s) => s.cameraId))].sort(), [snaps]);
  const shown = camera ? (snaps ?? []).filter((s) => s.cameraId === camera) : (snaps ?? []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSnapshots(ctrl.signal)
      .then(setSnaps)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : 'unreachable');
      });
    return () => ctrl.abort();
  }, []);

  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <h1>Snapshots</h1>
          <div className="page-head__sub">Position-stamped stills</div>
        </div>
      </header>
      <p className="muted">
        Telemetry-stamped stills — a bounded library (up to ~2000, pruned after 30 days). When there
        was no GPS fix the stamp says so, never a guessed position.
      </p>

      {cameras.length > 1 && (
        <div
          role="tablist"
          aria-label="Camera filter"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={camera === null}
            className={`chip ${camera === null ? 'chip--info' : 'chip--neutral'}`}
            onClick={() => setCamera(null)}
          >
            All
          </button>
          {cameras.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={camera === id}
              className={`chip ${camera === id ? 'chip--info' : 'chip--neutral'}`}
              onClick={() => setCamera(id)}
            >
              {id}
            </button>
          ))}
        </div>
      )}

      {err && <div className="chip chip--caution">Can’t load snapshots ({err})</div>}
      {snaps && snaps.length === 0 && !err && (
        <div className="empty">
          <p>No snapshots yet.</p>
          <p className="muted">Capture one with Snapshot on a camera.</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="snapgrid">
          {shown.map((s) => (
            <a
              key={s.id}
              className="snap"
              href={snapshotUrl(s.id)}
              target="_blank"
              rel="noreferrer"
            >
              <img className="snap__img" src={snapshotUrl(s.id)} alt="" loading="lazy" />
              <div className="snap__meta">
                <span className="snap__cam">{s.cameraId}</span>
                <time className="mono muted" dateTime={new Date(s.createdAt).toISOString()}>
                  {new Date(s.createdAt).toLocaleString()}
                </time>
                {s.telemetry.positionAvailable && s.telemetry.position ? (
                  <span className="chip chip--neutral mono">
                    {formatLatLon(s.telemetry.position.latitude, s.telemetry.position.longitude)}
                  </span>
                ) : (
                  <span className="chip chip--caution">No GPS fix</span>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
