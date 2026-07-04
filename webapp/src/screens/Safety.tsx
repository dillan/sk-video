import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchMobStatus,
  fetchCameras,
  armMob,
  markIncident,
  slewToCue,
  ApiError,
  type IMobStatus,
  type ICameraEntry,
} from '../api';
import { VideoPlayer } from '../components/VideoPlayer';
import { H264_TRANSPORTS } from '../lib/transport';

interface Msg {
  kind: 'caution' | 'info';
  text: string;
}

const DISARM_HOLD_MS = 800;
/** While armed, poll the MOB status so the re-aim heartbeat + aimed cameras stay live. */
const MOB_POLL_MS = 3000;

/** Format an epoch-ms heartbeat as HH:MM:SS, or "—" when absent. */
function clock(ms: number | null | undefined): string {
  return typeof ms === 'number' ? new Date(ms).toLocaleTimeString([], { hour12: false }) : '—';
}

function targetLine(s: IMobStatus): { text: string; caution: boolean } {
  switch (s.targetSource) {
    case 'beacon':
      return { text: 'Tracking the live AIS-MOB beacon position.', caution: false };
    case 'datum':
      return { text: 'Aiming at the dead-reckoned datum from the moment armed.', caution: false };
    default:
      return { text: 'No target — no GPS fix or beacon. Cameras can’t aim.', caution: true };
  }
}

function errMsg(err: unknown, what: string): Msg {
  if (err instanceof ApiError && err.status === 401) {
    return { kind: 'caution', text: 'Sign in to Signal K to use safety controls.' };
  }
  return { kind: 'caution', text: `Couldn’t ${what} — try again.` };
}

/**
 * The man-overboard / safety console. Arming aims every capable PTZ camera at a known position and is
 * honest throughout: it is geo-pointing, NOT visual tracking, and with no GPS fix it says it can't aim.
 * State is seeded from GET /mob so the strip never under-reports an active MOB. (The N-up datum/AIS
 * plot from the design needs own-ship + target geometry and lands as a refinement.)
 */
export function Safety({ onMobChange }: { onMobChange?: (s: IMobStatus) => void }) {
  const [status, setStatus] = useState<IMobStatus | null>(null);
  const [cams, setCams] = useState<ICameraEntry[]>([]);
  const [msg, setMsg] = useState<Msg | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback(
    (s: IMobStatus): void => {
      setStatus(s);
      onMobChange?.(s);
    },
    [onMobChange],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchMobStatus(ctrl.signal)
      .then(apply)
      .catch(() => undefined);
    fetchCameras(ctrl.signal)
      .then(setCams)
      .catch(() => undefined);
    return () => {
      ctrl.abort();
      if (holdRef.current) clearTimeout(holdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While armed, keep the heartbeat + aimed-camera state live.
  useEffect(() => {
    if (!status?.active) return;
    const t = setInterval(() => {
      fetchMobStatus()
        .then(apply)
        .catch(() => undefined);
    }, MOB_POLL_MS);
    return () => clearInterval(t);
  }, [status?.active, apply]);

  const capablePtz = cams.filter((c) => c.capabilities?.absolutePtz);

  const arm = (): void => {
    armMob(true)
      .then(apply)
      .catch((err: unknown) => setMsg(errMsg(err, 'arm MOB')));
  };
  const disarm = (): void => {
    armMob(false)
      .then(apply)
      .catch((err: unknown) => setMsg(errMsg(err, 'disarm')));
  };
  const startHold = (): void => {
    holdRef.current = setTimeout(disarm, DISARM_HOLD_MS);
  };
  const cancelHold = (): void => {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = null;
  };

  const mark = (): void => {
    markIncident()
      .then(() =>
        setMsg({ kind: 'info', text: 'Incident marked — capturing the clip and telemetry.' }),
      )
      .catch((err: unknown) => setMsg(errMsg(err, 'mark an incident')));
  };

  const slewAll = (): void => {
    if (capablePtz.length === 0) {
      setMsg({ kind: 'caution', text: 'No calibrated PTZ camera to slew.' });
      return;
    }
    Promise.allSettled(capablePtz.map((c) => slewToCue(c.id))).then((rs) => {
      const ok = rs.filter((r) => r.status === 'fulfilled').length;
      setMsg({
        kind: ok ? 'info' : 'caution',
        text: `Slewed ${ok} of ${capablePtz.length} cameras to the AIS cue.`,
      });
    });
  };

  const active = status?.active === true;
  const banner = (
    <div className="chip chip--caution mob__banner">
      Geo-pointing to a known position — <b>not visual person-tracking</b>. Supports, does not
      replace a lookout, the DSC MOB button, and a throwable. If GPS is lost, cameras can’t aim.
    </div>
  );

  if (!active) {
    return (
      <div className="mob mob--idle">
        <header className="page-head">
          <h1>Safety</h1>
        </header>
        {banner}
        <div className="empty">
          <p className="muted">
            Arming aims every capable camera at the casualty’s position, drops a marker, raises the
            alarm, and starts recording.
          </p>
          <button type="button" className="mob__arm" onClick={arm}>
            Arm man overboard
          </button>
          {msg && <span className={`chip chip--${msg.kind}`}>{msg.text}</span>}
        </div>
      </div>
    );
  }

  const target = targetLine(status);
  const capable = status.capableCameras || capablePtz.length;
  const aimedIds = new Set(status.aimedCameraIds ?? []);
  const aimOutcomes = new Map((status.cameraAims ?? []).map((a) => [a.id, a.outcome] as const));
  const refine = status.visualRefine;
  // The featured aimed camera for the reticle view: prefer a commanded one, else the first capable PTZ.
  const primaryId = status.aimedCameraIds?.[0] ?? capablePtz[0]?.id;
  const primary = cams.find((c) => c.id === primaryId);
  return (
    <div className="mob mob--armed">
      <header className="mob__header">
        <span className="mob__pulse" aria-hidden="true" />
        <div className="mob__title">
          <h1>Man overboard</h1>
          <div className="mono mob__sub">
            armed {clock(status.armedAt)} · re-aiming every 3 s · last {clock(status.lastReaimAt)}
          </div>
        </div>
        <button type="button" className="iconbtn iconbtn--wide" onClick={mark}>
          Mark incident
        </button>
        <button
          type="button"
          className="iconbtn iconbtn--wide iconbtn--stop"
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          // Keyboard equivalent of the press-and-hold: hold Enter/Space for the same duration.
          // e.repeat guards the auto-repeat keydown storm from restarting the timer each event.
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) startHold();
          }}
          onKeyUp={(e) => {
            if (e.key === 'Enter' || e.key === ' ') cancelHold();
          }}
          aria-label="Hold to disarm"
        >
          Hold to disarm
        </button>
      </header>
      {banner}
      <div className="mob__row">
        <span className={`chip chip--${target.caution ? 'caution' : 'info'}`}>{target.text}</span>
        <span className="chip chip--neutral">
          <b>{status.aimedCameras}</b>&nbsp;of {capable} cameras aimed
        </span>
        {refine?.enabled && (
          <span
            className="chip chip--caution"
            title="Experimental camera-nudge assist. It can lock onto a wake or whitecap and reverts to position-based aim on track loss — never rely on it."
          >
            Visual refine {refine.active ? 'active' : 'standby'} · NOT safety-rated
          </span>
        )}
        <button type="button" className="btn" onClick={slewAll}>
          Slew all to AIS cue
        </button>
        {msg && <span className={`chip chip--${msg.kind}`}>{msg.text}</span>}
      </div>

      <div className="mob__grid">
        <div className="mob__stage">
          {primary?.enabled ? (
            <VideoPlayer cameraId={primary.id} transports={H264_TRANSPORTS} variant="main" />
          ) : (
            <div className="tile__sheen" />
          )}
          <div className="mob__reticle" aria-hidden="true" />
          <div className="mob__stagelabel">
            {primary?.name ?? '—'}
            {aimedIds.has(primaryId ?? '') && <span className="mono"> · aimed</span>}
          </div>
        </div>

        <div className="mob__cams" role="list" aria-label="Aimed cameras">
          <div className="mob__camshead">
            <span>Aimed cameras</span>
            <span className="mono">
              {status.aimedCameras}/{capable}
            </span>
          </div>
          {capablePtz.length === 0 && <div className="muted">No calibrated PTZ camera to aim.</div>}
          {capablePtz.map((c) => {
            const offline = c.enabled === false;
            const outcome = aimOutcomes.get(c.id) ?? (aimedIds.has(c.id) ? 'aimed' : null);
            // A failed/limited aim is flagged explicitly — never folded into a silent "…".
            const chip = offline
              ? { text: 'offline', cls: 'chip--caution' }
              : outcome === 'aimed'
                ? { text: '✓ aimed', cls: 'chip--neutral mob__ok' }
                : outcome === 'at-limit'
                  ? { text: 'at pan limit — not on target', cls: 'chip--caution' }
                  : outcome === 'no-solution'
                    ? { text: 'no aim solution (calibrate)', cls: 'chip--caution' }
                    : outcome === 'command-failed'
                      ? { text: 'aim command failed', cls: 'chip--caution' }
                      : { text: '…', cls: 'chip--neutral' };
            return (
              <div className="mob__cam" role="listitem" key={c.id}>
                <span className={`chip ${chip.cls}`}>{chip.text}</span>
                <span className="mob__camname">{c.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
