import { useEffect, useRef, useState } from 'react';
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

interface Msg {
  kind: 'caution' | 'info';
  text: string;
}

const DISARM_HOLD_MS = 800;

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

  const apply = (s: IMobStatus): void => {
    setStatus(s);
    onMobChange?.(s);
  };

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
  return (
    <div className="mob mob--armed">
      <header className="mob__header">
        <span className="mob__pulse" aria-hidden="true" />
        <div className="mob__title">
          <h1>Man overboard</h1>
          <div className="mono mob__sub">armed · re-aiming every 3 s</div>
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
          aria-label="Hold to disarm"
        >
          Hold to disarm
        </button>
      </header>
      {banner}
      <div className="mob__row">
        <span className={`chip chip--${target.caution ? 'caution' : 'info'}`}>{target.text}</span>
        <span className="chip chip--neutral">
          <b>{status.aimedCameras}</b>&nbsp;of {capablePtz.length} cameras aimed
        </span>
      </div>
      <div className="mob__actions">
        <button type="button" className="btn" onClick={slewAll}>
          Slew all to AIS cue
        </button>
        {msg && <span className={`chip chip--${msg.kind}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
