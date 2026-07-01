import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCameras,
  fetchTransport,
  ptzNudge,
  ptzStop,
  applyImagingPreset,
  captureSnapshot,
  setRecording,
  ApiError,
  type ICameraEntry,
  type ITransportHints,
  type TTransport,
  type TStreamVariant,
  type TImagingPreset,
} from '../api';
import { transportLabel, ptzDelayed, isHevc, transportsForVariant } from '../lib/transport';
import { VideoPlayer } from '../components/VideoPlayer';
import { PtzPad, type IPtzDetail } from '../components/PtzPad';
import { usePtzGestures } from '../components/usePtzGestures';

interface Props {
  cameraId: string;
  onBack: () => void;
}

interface Msg {
  kind: 'caution' | 'info';
  text: string;
}

/** Map an action error to honest copy (sign-in required, channels full, unsupported, generic). */
function actionMessage(err: unknown, what: string): Msg {
  if (err instanceof ApiError) {
    if (err.status === 401)
      return { kind: 'caution', text: 'Sign in to Signal K to control cameras.' };
    if (err.status === 409 && what === 'record') {
      return { kind: 'caution', text: 'Recording channels full — stop one to record.' };
    }
    if (err.status === 409) return { kind: 'caution', text: 'This camera doesn’t support that.' };
    // The server diagnosed *why* a camera/ONVIF action failed (502) and sent an actionable next
    // step — show it instead of a useless "try again." (See src/onvif/onvif-errors.ts.)
    if (err.hint) return { kind: 'caution', text: err.hint };
  }
  return { kind: 'caution', text: `Couldn’t ${what} — try again.` };
}

const PRESETS: { id: TImagingPreset; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' },
  { id: 'fog', label: 'Fog' },
  { id: 'glare', label: 'Glare' },
];

/** Pad footprint by form factor: the design uses 88 on phones, 100 on tablet/desktop. */
function usePadSize(): number {
  const query = '(max-width: 640px)';
  const [size, setSize] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.(query).matches ? 88 : 100,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = (): void => setSize(mq.matches ? 88 : 100);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return size;
}

/** A live HH:MM:SS clock for the focus top bar (matches the design's stamped-time treatment). */
function FocusClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="focus__clock mono" aria-hidden="true">
      {now.toLocaleTimeString([], { hour12: false })}
    </span>
  );
}

export function CameraFocus({ cameraId, onBack }: Props) {
  const [camera, setCamera] = useState<ICameraEntry | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hints, setHints] = useState<ITransportHints | null>(null);
  const [rung, setRung] = useState<TTransport>('mjpeg');
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [recording, setRec] = useState(false);
  // Operator override of the auto sub/main choice (null = auto). Reset when the camera changes.
  const [override, setOverride] = useState<TStreamVariant | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((m: Msg) => {
    setMsg(m);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), 5000);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setOverride(null); // a new camera starts on its auto sub/main choice
    setActive(false);
    fetchCameras(ctrl.signal)
      .then((cams) => {
        const found = cams.find((c) => c.id === cameraId) ?? null;
        setCamera(found);
        setNotFound(found === null);
      })
      .catch(() => setNotFound(true));
    fetchTransport(cameraId, ctrl.signal)
      .then(setHints)
      .catch(() => setHints({ recommended: ['mjpeg'], codecs: [], online: false, note: '' }));
    return () => {
      ctrl.abort();
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, [cameraId]);

  const run = (what: string, fn: () => Promise<unknown>, ok?: Msg) => () => {
    fn()
      .then(() => ok && flash(ok))
      .catch((err: unknown) => flash(actionMessage(err, what)));
  };

  const nudge = (move: { pan?: number; tilt?: number; zoom?: number }) =>
    run('move the camera', async () => {
      await ptzNudge(cameraId, move);
      setTimeout(() => void ptzStop(cameraId).catch(() => undefined), 350);
    });

  const ptz = camera?.capabilities?.ptz === true;
  const delayed = ptzDelayed(rung);
  const padSize = usePadSize();

  // Full-frame drag/pinch/scroll gestures over the video, in addition to the dock pad — a quick way
  // to nudge the camera without reaching for the control. Continuous PTZ is unsafe on a 1 fps still-
  // refresh feed (you can't see where you're aiming for 1–2 s), so it's live-feed only.
  const gestures = usePtzGestures({
    enabled: ptz && !delayed,
    onMove: (v) => {
      void ptzNudge(cameraId, v).catch((err: unknown) =>
        flash(actionMessage(err, 'move the camera')),
      );
    },
    onStop: () => void ptzStop(cameraId).catch(() => undefined),
  });

  // The glass PTZ pad drives ONVIF continuousMove: dragging the knob is a velocity joystick, a chevron
  // is a discrete step. A continuousMove holds until changed/stopped, so drag commands are throttled
  // (only the latest lands within a window) and the server arms a runaway auto-stop behind us.
  const lastPan = useRef<{ t: number; timer: ReturnType<typeof setTimeout> | null }>({
    t: 0,
    timer: null,
  });
  const sendPan = useCallback(
    (x: number, y: number) => {
      if (lastPan.current.timer) {
        clearTimeout(lastPan.current.timer);
        lastPan.current.timer = null;
      }
      const wait = Math.max(0, 140 - (Date.now() - lastPan.current.t));
      const fire = () => {
        lastPan.current.t = Date.now();
        void ptzNudge(cameraId, { pan: x, tilt: y }).catch((err: unknown) =>
          flash(actionMessage(err, 'move the camera')),
        );
      };
      if (wait === 0) fire();
      else lastPan.current.timer = setTimeout(fire, wait);
    },
    [cameraId, flash],
  );
  const onPtzPad = useCallback(
    (d: IPtzDetail) => {
      if (d.type === 'panend') {
        if (lastPan.current.timer) clearTimeout(lastPan.current.timer);
        lastPan.current = { t: 0, timer: null };
        void ptzStop(cameraId).catch(() => undefined);
      } else if (d.type === 'step') {
        // A chevron is a discrete nudge: brief move toward the direction, then auto-stop.
        void ptzNudge(cameraId, { pan: d.x * 0.5, tilt: d.y * 0.5 })
          .then(() => setTimeout(() => void ptzStop(cameraId).catch(() => undefined), 350))
          .catch((err: unknown) => flash(actionMessage(err, 'move the camera')));
      } else {
        sendPan(d.x, d.y);
      }
    },
    [cameraId, flash, sendPan],
  );

  const snapshot = run('save a snapshot', async () => {
    const r = await captureSnapshot(cameraId);
    flash(
      r.hasFix === false
        ? { kind: 'caution', text: 'Snapshot saved — no GPS fix, position not stamped.' }
        : { kind: 'info', text: 'Snapshot saved.' },
    );
  });

  const toggleRecord = run('record', async () => {
    const r = await setRecording(cameraId, !recording);
    setRec(r.recording);
    flash({ kind: 'info', text: r.recording ? 'Recording started.' : 'Recording stopped.' });
  });

  if (notFound) {
    return (
      <div className="empty">
        <p>Camera not found.</p>
        <button type="button" className="btn" onClick={onBack}>
          Back to Live
        </button>
      </div>
    );
  }

  // The browser can't decode an H.265 main stream live, so when the camera has an H.264 substream we
  // play that instead. We treat the main as H.265 if onboarding recorded it OR go2rtc negotiated HEVC.
  // Gate on the actual stored substreamPath (what the server serves `?variant=sub` from) — never the
  // capability flag alone, so we can't request a sub the server has no `_sub` stream for.
  const mainIsHevc = camera?.media?.codec === 'h265' || isHevc(hints?.codecs ?? []);
  // A sub is selectable only when the server actually serves `?variant=sub` from a stored substreamPath.
  const hasSub = !!camera?.media?.substreamPath && camera?.capabilities?.substreams === true;
  // Auto-pick the H.264 sub for an H.265 main; the operator can override either way when a sub exists.
  const variant: TStreamVariant = override ?? (hasSub && mainIsHevc ? 'sub' : 'main');
  // The sub is H.264 → WebRTC-first; the main keeps the server's codec-aware order.
  const transports = hints ? transportsForVariant(variant === 'sub', hints.recommended) : [];
  // Forcing the full-res main on an H.265 camera may not decode in this browser — say so honestly.
  const mainWontPlay = variant === 'main' && mainIsHevc;

  return (
    <div className="focus">
      <div className="focus__stage">
        {hints && camera && (
          <VideoPlayer
            cameraId={cameraId}
            transports={transports}
            variant={variant}
            onRung={setRung}
            onActive={setActive}
          />
        )}
        {ptz && !delayed && (
          <div
            ref={gestures.setRef}
            className={`focus__gestures${gestures.active ? ' focus__gestures--active' : ''}`}
            aria-hidden="true"
          >
            {gestures.active && gestures.vector && (
              <div className="joystick" aria-hidden="true">
                <span
                  className="joystick__knob"
                  style={{
                    transform: `translate(${gestures.vector.pan * 26}px, ${
                      -gestures.vector.tilt * 26
                    }px)`,
                  }}
                />
              </div>
            )}
          </div>
        )}
        <div className="focus__top">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onBack}
            aria-label="Back to Live"
          >
            ‹ All cameras
          </button>
          <span className={`chip ${active ? 'chip--live' : 'chip--neutral'}`}>
            {active && <span className="dot dot--rec" />}
            {active ? 'LIVE' : 'Connecting…'}
          </span>
          <span className="chip chip--neutral">
            {camera?.name ?? cameraId}
            <span className="mono">
              {' '}
              · {transportLabel(rung)} · {variant}
            </span>
          </span>
          {variant === 'sub' && mainIsHevc && (
            <span className="chip chip--caution">H.264 sub-stream · main is H.265</span>
          )}
          {mainWontPlay && (
            <span className="chip chip--caution">Full-res H.265 · may not play here</span>
          )}
          <div className="page-head__spacer" />
          <FocusClock />
        </div>
        {msg && (
          <div className={`focus__msg chip chip--${msg.kind === 'caution' ? 'caution' : 'info'}`}>
            {msg.text}
          </div>
        )}
        <div className="focus__dock" role="group" aria-label="Camera controls">
          {hasSub && (
            <div className="dock__group" role="group" aria-label="Stream quality">
              <button
                type="button"
                className={`iconbtn iconbtn--wide${variant === 'sub' ? ' iconbtn--on' : ''}`}
                aria-pressed={variant === 'sub'}
                onClick={() => setOverride('sub')}
              >
                Sub
              </button>
              <button
                type="button"
                className={`iconbtn iconbtn--wide${variant === 'main' ? ' iconbtn--on' : ''}`}
                aria-pressed={variant === 'main'}
                onClick={() => setOverride('main')}
              >
                Full res
              </button>
            </div>
          )}
          {ptz && (
            <div className="dock__group">
              {delayed && (
                <span className="chip chip--caution">still-refresh — PTZ delayed ~1–2 s</span>
              )}
              <div className="ptzpad" style={{ width: padSize, height: padSize }}>
                <PtzPad size={padSize} onPtz={onPtzPad} />
              </div>
              <button
                type="button"
                className="iconbtn"
                onClick={nudge({ zoom: 0.5 })}
                aria-label="Zoom in"
              >
                ＋
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={nudge({ zoom: -0.5 })}
                aria-label="Zoom out"
              >
                －
              </button>
              <button
                type="button"
                className="iconbtn iconbtn--stop"
                onClick={run('stop', () => ptzStop(cameraId))}
                aria-label="Stop camera movement"
              >
                STOP
              </button>
            </div>
          )}
          <div className="dock__group">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="iconbtn iconbtn--wide"
                onClick={run('change the picture', () => applyImagingPreset(cameraId, p.id))}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="dock__group">
            <button type="button" className="iconbtn iconbtn--wide" onClick={snapshot}>
              Snapshot
            </button>
            <button
              type="button"
              className={`iconbtn iconbtn--wide${recording ? ' iconbtn--rec' : ''}`}
              onClick={toggleRecord}
            >
              {recording ? 'Stop' : 'Record'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
