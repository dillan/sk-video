import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCameras,
  fetchTransport,
  ptzNudge,
  ptzStop,
  type ICameraEntry,
  type ITransportHints,
  type TTransport,
  type TStreamVariant,
} from '../api';
import { ptzDelayed, isHevc, transportsForVariant } from '../lib/transport';
import { loadContinuousPtz } from '../lib/ptz-prefs';
import { actionMessage, type IMsg } from '../lib/camera-messages';
import { VideoPlayer } from '../components/VideoPlayer';
import { usePtzGestures } from '../components/usePtzGestures';
import { CameraControls } from '../components/CameraControls';

interface Props {
  cameraId: string;
  onBack: () => void;
}

/** Form factor by width: the phone thumb-zone layout below 640px, the oversized tablet/desktop layout
 *  above it (they share a layout per the design). Pad footprint follows: 88 phone, 104 tablet/desktop. */
function useFormFactor(): 'phone' | 'tablet' {
  const query = '(max-width: 640px)';
  const [ff, setFf] = useState<'phone' | 'tablet'>(() =>
    typeof window !== 'undefined' && window.matchMedia?.(query).matches ? 'phone' : 'tablet',
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = (): void => setFf(mq.matches ? 'phone' : 'tablet');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return ff;
}

export function CameraFocus({ cameraId, onBack }: Props) {
  const [camera, setCamera] = useState<ICameraEntry | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hints, setHints] = useState<ITransportHints | null>(null);
  const [rung, setRung] = useState<TTransport>('mjpeg');
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState<IMsg | null>(null);
  // Operator override of the auto sub/main choice (null = auto). Reset when the camera changes.
  const [override, setOverride] = useState<TStreamVariant | null>(null);
  // Server walk for the sub variant (its own codecs -> its own order); null until fetched.
  const [subHints, setSubHints] = useState<ITransportHints | null>(null);
  // Manual transport pin (null = auto walk with fallback). Reset when the camera changes.
  const [forced, setForced] = useState<TTransport | null>(null);
  // Continuous press-and-hold PTZ is a per-device opt-in; discrete nudges are the default.
  const continuousPtz = loadContinuousPtz();
  // Whether the operator is listening to camera audio (unmutes the player); off by default.
  const [listening, setListening] = useState(false);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formFactor = useFormFactor();
  const padSize = formFactor === 'phone' ? 88 : 104;

  const flash = useCallback((m: IMsg) => {
    setMsg(m);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), 5000);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setOverride(null); // a new camera starts on its auto sub/main choice
    setSubHints(null);
    setForced(null);
    setActive(false);
    setListening(false);
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

  const ptz = camera?.capabilities?.ptz === true;
  const delayed = ptzDelayed(rung);

  // While the operator is driving PTZ, tell the player to refresh a still-refresh feed fast (so the
  // move is visible right away). Held ~700 ms past the last input so it spans brief pauses, then relaxes.
  const [ptzActive, setPtzActive] = useState(false);
  const ptzActiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpPtzActive = useCallback(() => {
    setPtzActive(true);
    if (ptzActiveTimer.current) clearTimeout(ptzActiveTimer.current);
    ptzActiveTimer.current = setTimeout(() => setPtzActive(false), 700);
  }, []);
  useEffect(() => {
    return () => {
      if (ptzActiveTimer.current) clearTimeout(ptzActiveTimer.current);
    };
  }, []);

  // Full-frame drag/pinch/scroll gestures over the video, in addition to the dock pad — a quick way
  // to nudge the camera without reaching for the control. Continuous PTZ is unsafe on a 1 fps still-
  // refresh feed (you can't see where you're aiming for 1–2 s), so it's live-feed only.
  const gestures = usePtzGestures({
    enabled: ptz && !delayed && continuousPtz,
    onMove: (v) => {
      bumpPtzActive();
      void ptzNudge(cameraId, v).catch((err: unknown) =>
        flash(actionMessage(err, 'move the camera')),
      );
    },
    onStop: () => void ptzStop(cameraId).catch(() => undefined),
  });

  // The browser can't decode an H.265 main stream live, so when the camera has an H.264 substream we
  // play that instead. We treat the main as H.265 if onboarding recorded it OR go2rtc negotiated HEVC.
  const mainIsHevc = camera?.media?.codec === 'h265' || isHevc(hints?.codecs ?? []);
  // A sub is selectable only when the server actually serves `?variant=sub` from a stored substreamPath.
  const hasSub = !!camera?.media?.substreamPath && camera?.capabilities?.substreams === true;
  const variant: TStreamVariant = override ?? (hasSub && mainIsHevc ? 'sub' : 'main');
  // A pinned transport plays exactly that rung (no automatic fallback — that's the point of a pin);
  // auto plays the server walk for the variant, with the H.264 order as the sub's fetch-time fallback.
  const autoWalk =
    variant === 'sub'
      ? (subHints?.recommended ??
        (hints ? transportsForVariant(true, hints.recommended) : ['webrtc', 'hls', 'mjpeg']))
      : (hints?.recommended ?? []);
  const transports = forced ? [forced] : (autoWalk as TTransport[]);

  // The sub walk is server-driven too: fetch /transport?variant=sub once the sub is playing.
  useEffect(() => {
    if (variant !== 'sub' || subHints !== null) return;
    const ctrl = new AbortController();
    fetchTransport(cameraId, ctrl.signal, 'sub')
      .then(setSubHints)
      .catch(() => undefined); // fall back to the client H.264 order
    return () => ctrl.abort();
  }, [variant, subHints, cameraId]);

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
            responsive={ptzActive}
            muted={!listening}
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
        {camera && (
          <CameraControls
            cameraId={cameraId}
            camera={camera}
            formFactor={formFactor}
            padSize={padSize}
            rung={rung}
            delayed={delayed}
            variant={variant}
            hasSub={hasSub}
            mainIsHevc={mainIsHevc}
            onVariant={setOverride}
            forcedTransport={forced}
            onForceTransport={setForced}
            continuousPan={continuousPtz}
            onBack={onBack}
            live={active}
            flash={flash}
            onPtzActivity={bumpPtzActive}
            listening={listening}
            onListen={setListening}
          />
        )}
        {msg && (
          <div className={`focus__msg chip chip--${msg.kind === 'caution' ? 'caution' : 'info'}`}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
