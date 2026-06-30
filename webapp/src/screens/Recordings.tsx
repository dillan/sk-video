import { useEffect, useState } from 'react';
import {
  fetchRecordingTimeline,
  recordingUrl,
  type IRecordingCameraTimeline,
  type IRecordingSegment,
  type IRecordingGap,
} from '../api';
import { formatClock, formatDuration, formatBytes } from '../lib/format';

type Row =
  | { kind: 'seg'; t: number; seg: IRecordingSegment }
  | { kind: 'gap'; t: number; gap: IRecordingGap };

/** Merge a camera's segments and coverage gaps into one newest-first timeline. */
function rows(cam: IRecordingCameraTimeline): Row[] {
  return [
    ...cam.segments.map((seg): Row => ({ kind: 'seg', t: seg.startedAt, seg })),
    ...cam.gaps.map((gap): Row => ({ kind: 'gap', t: gap.startedAt, gap })),
  ].sort((a, b) => b.t - a.t);
}

/**
 * The Review cluster's Recordings tab: the rolling DVR buffer per camera. Honest about what it is — a
 * best-effort buffer (not a 24/7 NVR) that prunes old footage, with neutral "No coverage" gap markers
 * (the backend records where coverage stopped, never a fabricated cause). Segments stream by Range.
 */
export function Recordings() {
  const [cameras, setCameras] = useState<IRecordingCameraTimeline[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRecordingTimeline(ctrl.signal)
      .then((t) => setCameras(t.cameras))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : 'unreachable');
      });
    return () => ctrl.abort();
  }, []);

  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <h1>Recordings</h1>
          <div className="page-head__sub">Rolling buffer · best-effort</div>
        </div>
      </header>
      <p className="muted">
        A best-effort rolling buffer (~10&nbsp;GiB / 48&nbsp;h), not a 24/7 NVR — old footage is
        pruned automatically. Gaps show where coverage stopped, with no fabricated cause.
      </p>

      {err && <div className="chip chip--caution">Can’t load recordings ({err})</div>}
      {cameras && cameras.length === 0 && !err && (
        <div className="empty">
          <p>No recordings yet.</p>
          <p className="muted">
            Recording needs a capable hardware tier; start it with Record on a camera.
          </p>
        </div>
      )}

      {cameras?.map((cam) => (
        <section key={cam.camera} className="panel rec">
          <div className="rec__head">
            <div className="rec__cam">{cam.camera}</div>
            {cam.recording && (
              <span className="chip chip--live">
                <span className="dot dot--rec" /> Recording
              </span>
            )}
          </div>
          <ul className="rec__list">
            {rows(cam).map((row, i) =>
              row.kind === 'seg' ? (
                <li key={row.seg.name} className="rec__row">
                  <button
                    type="button"
                    className="iconbtn iconbtn--wide"
                    onClick={() => setPlaying(playing === row.seg.name ? null : row.seg.name)}
                  >
                    {playing === row.seg.name ? 'Hide' : 'Play'}
                  </button>
                  <span className="rec__time mono">{formatClock(row.seg.startedAt)}</span>
                  <span className="rec__meta mono">
                    {formatDuration(row.seg.durationMs)} · {formatBytes(row.seg.bytes)}
                  </span>
                </li>
              ) : (
                <li key={`gap-${i}`} className="rec__gap mono">
                  No coverage {formatClock(row.gap.startedAt)}–{formatClock(row.gap.endedAt)}
                </li>
              ),
            )}
          </ul>
          {playing && cam.segments.some((s) => s.name === playing) && (
            <video
              className="vidrow__player"
              src={recordingUrl(playing)}
              controls
              preload="metadata"
            />
          )}
        </section>
      ))}
    </div>
  );
}
