import { useEffect, useState } from 'react';
import { fetchHealth, fetchTransport, type IStreamHealth, type ITransportHints } from '../api';
import { transportLabel, isHevc } from '../lib/transport';

/**
 * Per-camera diagnostics: is go2rtc producing, what codec did it negotiate, and the transport walk.
 * This is where a "why is the video black?" answer lives — most often an H.265 main stream (which
 * browsers can't decode) rather than a connectivity problem. go2rtc connects lazily, so "no producer"
 * with no viewer is normal, not necessarily a fault.
 */
export function CameraHealth({
  id,
  name,
  onBack,
}: {
  id: string;
  name: string;
  onBack: () => void;
}) {
  const [health, setHealth] = useState<IStreamHealth | null>(null);
  const [hints, setHints] = useState<ITransportHints | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setErr(null);
    fetchHealth(id, ctrl.signal)
      .then(setHealth)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'unreachable'));
    fetchTransport(id, ctrl.signal)
      .then(setHints)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [id]);

  const codecs = health?.codecs ?? [];
  const hevc = isHevc(codecs);

  return (
    <div className="cameras">
      <header className="page-head">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ‹ Cameras
        </button>
        <div>
          <h1>{name}</h1>
          <div className="page-head__sub">Diagnostics</div>
        </div>
      </header>

      {err && <div className="chip chip--caution">Can’t read health ({err})</div>}

      {health && (
        <div className="panel diag">
          <div className="diag__row">
            <span className="muted">Stream</span>
            <span>
              {health.online ? (
                <span className="chip chip--neutral">
                  <span className="dot dot--online" /> producing
                </span>
              ) : (
                <span className="chip chip--neutral">idle — no active producer</span>
              )}
            </span>
          </div>
          <div className="diag__row">
            <span className="muted">Producers / consumers</span>
            <span className="mono">
              {health.producers} / {health.consumers}
            </span>
          </div>
          <div className="diag__row">
            <span className="muted">Codecs</span>
            <span className="mono">
              {codecs.length ? codecs.join(', ') : '— (connect to negotiate)'}
            </span>
          </div>
          {hints && (
            <div className="diag__row">
              <span className="muted">Transport walk</span>
              <span className="mono">{hints.recommended.map(transportLabel).join(' → ')}</span>
            </div>
          )}
          {health.sources.length > 0 && (
            <div className="diag__row">
              <span className="muted">Source</span>
              <span className="mono">{health.sources.join(', ')}</span>
            </div>
          )}
          {hevc && (
            <div className="chip chip--caution diag__note">
              This stream is <b>H.265 / HEVC</b> — most browsers (including Chrome) can’t decode it
              for live view. Use the camera’s <b>H.264 sub-stream</b> (or set the main stream to
              H.264); H.265 still records fine. Safari can play HEVC.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
