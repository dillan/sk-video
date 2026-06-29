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
  type TImagingPreset,
} from '../api';
import { transportLabel, ptzDelayed } from '../lib/transport';
import { VideoPlayer } from '../components/VideoPlayer';

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

export function CameraFocus({ cameraId, onBack }: Props) {
  const [camera, setCamera] = useState<ICameraEntry | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hints, setHints] = useState<ITransportHints | null>(null);
  const [rung, setRung] = useState<TTransport>('mjpeg');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [recording, setRec] = useState(false);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((m: Msg) => {
    setMsg(m);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), 5000);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
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

  const nudge = (move: { pan?: number; tilt?: number }) =>
    run('move the camera', async () => {
      await ptzNudge(cameraId, move);
      setTimeout(() => void ptzStop(cameraId).catch(() => undefined), 350);
    });

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

  const ptz = camera?.capabilities?.ptz === true;
  const delayed = ptzDelayed(rung);

  return (
    <div className="focus">
      <div className="focus__stage">
        {hints && (
          <VideoPlayer cameraId={cameraId} transports={hints.recommended} onRung={setRung} />
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
          <span className="chip chip--neutral">
            {camera?.name ?? cameraId}
            <span className="mono"> · {transportLabel(rung)}</span>
          </span>
        </div>
        {msg && (
          <div className={`focus__msg chip chip--${msg.kind === 'caution' ? 'caution' : 'info'}`}>
            {msg.text}
          </div>
        )}
        <div className="focus__dock" role="group" aria-label="Camera controls">
          {ptz && (
            <div className="dock__group">
              {delayed && (
                <span className="chip chip--caution">still-refresh — PTZ delayed ~1–2 s</span>
              )}
              <button
                type="button"
                className="iconbtn"
                onClick={nudge({ pan: -0.4 })}
                aria-label="Pan left"
              >
                ◀
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={nudge({ tilt: 0.4 })}
                aria-label="Tilt up"
              >
                ▲
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={nudge({ tilt: -0.4 })}
                aria-label="Tilt down"
              >
                ▼
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={nudge({ pan: 0.4 })}
                aria-label="Pan right"
              >
                ▶
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
