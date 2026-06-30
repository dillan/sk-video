import { useEffect, useState } from 'react';
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

      {err && <div className="chip chip--caution">Can’t load snapshots ({err})</div>}
      {snaps && snaps.length === 0 && !err && (
        <div className="empty">
          <p>No snapshots yet.</p>
          <p className="muted">Capture one with Snapshot on a camera.</p>
        </div>
      )}
      {snaps && snaps.length > 0 && (
        <div className="snapgrid">
          {snaps.map((s) => (
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
