import { useEffect, useState } from 'react';
import {
  fetchRecordingTimeline,
  fetchStatus,
  recordingUrl,
  markIncident,
  type IRecordingCameraTimeline,
} from '../api';
import { formatClock } from '../lib/format';
import { cameraSpan, layoutBlocks, fractionToTime, locateTime } from '../lib/timeline';

/** One camera's scrubbable DVR track: proportional segments + neutral gaps, click/keys to seek. */
function CameraDvr({
  cam,
  onMark,
  marking,
}: {
  cam: IRecordingCameraTimeline;
  onMark: (camera: string, t: number) => void;
  marking: boolean;
}) {
  const span = cameraSpan(cam);
  const blocks = layoutBlocks(cam);
  const [t, setT] = useState<number | null>(null);
  const loc = t != null ? locateTime(cam, t) : null;
  const playheadPct = t != null && span.lengthMs > 0 ? ((t - span.start) / span.lengthMs) * 100 : 0;

  const step = (dir: number) => {
    const base = t ?? span.start;
    setT(Math.min(span.end, Math.max(span.start, base + (dir * span.lengthMs) / 100)));
  };

  return (
    <section className="panel rec">
      <div className="rec__head">
        <div className="rec__cam">{cam.camera}</div>
        {cam.recording && (
          <span className="chip chip--live">
            <span className="dot dot--rec" /> Recording
          </span>
        )}
        <div className="page-head__spacer" />
        <span className="rec__span mono">
          {formatClock(span.start)}–{formatClock(span.end)}
        </span>
      </div>

      <div
        className="dvr__track"
        role="slider"
        tabIndex={0}
        aria-label={`Scrub ${cam.camera} recordings`}
        aria-valuemin={span.start}
        aria-valuemax={span.end}
        aria-valuenow={t ?? span.start}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setT(fractionToTime(span, (e.clientX - r.left) / r.width));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            step(1);
            e.preventDefault();
          } else if (e.key === 'ArrowLeft') {
            step(-1);
            e.preventDefault();
          }
        }}
      >
        {blocks.map((b, i) => (
          <span
            key={i}
            className={b.kind === 'seg' ? 'dvr__seg' : 'dvr__gap'}
            style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
            title={
              b.kind === 'gap'
                ? `No coverage ${formatClock(b.gap!.startedAt)}–${formatClock(b.gap!.endedAt)}`
                : formatClock(b.seg!.startedAt)
            }
          />
        ))}
        {t != null && <span className="dvr__playhead" style={{ left: `${playheadPct}%` }} />}
      </div>

      {t != null && (
        <div className="dvr__panel">
          <span className="mono dvr__at">{formatClock(t)}</span>
          {loc ? (
            <video
              key={loc.name}
              className="vidrow__player"
              src={recordingUrl(loc.name)}
              controls
              preload="metadata"
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = loc.offsetSec;
              }}
            />
          ) : (
            <span className="chip chip--caution">No coverage at this point</span>
          )}
          <button
            type="button"
            className="iconbtn iconbtn--wide"
            // A gap has nothing in the buffer to cut — offering the mark there would mint an
            // empty/failed bundle, so the affordance is honestly disabled instead.
            disabled={marking || !loc}
            onClick={() => onMark(cam.camera, t)}
            title={
              loc
                ? 'Capture an incident bundle from the rolling buffer around this moment'
                : 'No coverage at this point — there is nothing in the buffer to capture'
            }
          >
            {marking ? 'Marking…' : 'Mark incident here'}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The Review cluster's Recordings tab: a scrubbable DVR per camera. Honest about what it is — a
 * best-effort rolling buffer (not a 24/7 NVR) that prunes old footage, with neutral gap markers (the
 * backend records where coverage stopped, never a fabricated cause). Click/scrub the track to seek;
 * "Mark incident here" mints a retrospective bundle from the buffer around that moment.
 */
export function Recordings() {
  const [cameras, setCameras] = useState<IRecordingCameraTimeline[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'info' | 'caution'; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [recordingChannels, setRecordingChannels] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRecordingTimeline(ctrl.signal)
      .then((t) => setCameras(t.cameras))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : 'unreachable');
      });
    // Tier context for the empty state: "no recordings" on a tier with zero channels is a
    // capability fact, not an operator omission.
    fetchStatus(ctrl.signal)
      .then((s) => {
        const caps = (
          s.hardware as { capabilities?: { maxRecordingChannels?: number } } | null | undefined
        )?.capabilities;
        setRecordingChannels(caps?.maxRecordingChannels ?? null);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  // One camera at a time (the design's tabbed DVR); default to the first with footage.
  const active = selected ?? cameras?.[0]?.camera ?? null;
  const shown = cameras?.filter((c) => c.camera === active) ?? [];

  const onMark = async (camera: string, t: number) => {
    setMarking(camera);
    setMsg(null);
    try {
      const res = await markIncident({ cameras: [camera], triggerAt: t });
      const { id } = (await res.json()) as { id: string };
      setMsg({ kind: 'info', text: `Incident marked from ${formatClock(t)} — capturing (${id}).` });
    } catch (e: unknown) {
      setMsg({ kind: 'caution', text: e instanceof Error ? e.message : 'mark failed' });
    } finally {
      setMarking(null);
    }
  };

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
        pruned automatically. Scrub a track to review; gaps show where coverage stopped, with no
        fabricated cause.
      </p>

      {cameras && cameras.length > 1 && (
        <nav className="seg" aria-label="Recorded cameras">
          {cameras.map((c) => (
            <button
              key={c.camera}
              type="button"
              className={`iconbtn iconbtn--wide${c.camera === active ? ' iconbtn--on' : ''}`}
              aria-pressed={c.camera === active}
              onClick={() => setSelected(c.camera)}
            >
              {c.camera}
            </button>
          ))}
        </nav>
      )}

      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}
      {err && <div className="chip chip--caution">Can’t load recordings ({err})</div>}
      {cameras && cameras.length === 0 && !err && (
        <div className="empty">
          <p>No recordings yet.</p>
          {recordingChannels === 0 ? (
            <p className="muted">
              Recording isn’t available on this hardware tier — live viewing still works. A Pi&nbsp;4
              or better enables the rolling buffer.
            </p>
          ) : (
            <p className="muted">Start one with Record on a camera.</p>
          )}
        </div>
      )}

      {shown.map((cam) => (
        <CameraDvr key={cam.camera} cam={cam} onMark={onMark} marking={marking === cam.camera} />
      ))}
    </div>
  );
}
