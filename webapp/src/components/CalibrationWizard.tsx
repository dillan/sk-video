import { useState } from 'react';
import {
  ptzNudge,
  ptzStop,
  fetchPtzPosition,
  submitCalibration,
  ApiError,
  type ICalibrationSample,
} from '../api';

type Axis = 'pan' | 'tilt';
type Slot = 0 | 1;
interface Msg {
  kind: 'caution' | 'info';
  text: string;
}

/**
 * Two-point-per-axis FOV calibration. Absolute ONVIF moves are normalised (−1..1), so geo-pointing
 * (MOB / AIS slew) needs a per-camera degrees→normalised map. The operator nudges the camera to two
 * known bearings per axis and captures each: we read the camera's normalised position and pair it with
 * the bearing they observed. Honest: it's a static map — re-run after the camera is remounted or sags.
 */
export function CalibrationWizard({
  id,
  name,
  onDone,
}: {
  id: string;
  name: string;
  onDone: (saved: boolean) => void;
}) {
  const [pan, setPan] = useState<(ICalibrationSample | null)[]>([null, null]);
  const [tilt, setTilt] = useState<(ICalibrationSample | null)[]>([null, null]);
  const [deg, setDeg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const fail = (err: unknown, what: string): void =>
    setMsg({
      kind: 'caution',
      text:
        err instanceof ApiError && err.status === 401
          ? 'Sign in to Signal K to calibrate.'
          : `Couldn’t ${what}.`,
    });

  const nudge = (move: { pan?: number; tilt?: number }): void => {
    ptzNudge(id, move)
      .then(() => setTimeout(() => void ptzStop(id).catch(() => undefined), 350))
      .catch((err: unknown) => fail(err, 'move the camera'));
  };

  const capture = (axis: Axis, slot: Slot): void => {
    const raw = deg[`${axis}${slot}`];
    const d = raw === undefined || raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(d)) {
      setMsg({ kind: 'caution', text: 'Enter the bearing you aimed at first.' });
      return;
    }
    fetchPtzPosition(id)
      .then((pos) => {
        const sample = { deg: d, normalized: axis === 'pan' ? pos.pan : pos.tilt };
        const setter = axis === 'pan' ? setPan : setTilt;
        setter((prev) => prev.map((s, i) => (i === slot ? sample : s)));
        setMsg({ kind: 'info', text: `Captured ${axis} point ${slot + 1}.` });
      })
      .catch((err: unknown) => fail(err, 'read the camera position'));
  };

  const ready = pan.every(Boolean) && tilt.every(Boolean);

  const save = (): void => {
    if (!ready) return;
    setBusy(true);
    submitCalibration(id, {
      pan: pan as ICalibrationSample[],
      tilt: tilt as ICalibrationSample[],
    })
      .then(() => onDone(true))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 400) {
          setMsg({
            kind: 'caution',
            text: 'Each axis needs two points at clearly different angles.',
          });
        } else {
          fail(err, 'save the calibration');
        }
      })
      .finally(() => setBusy(false));
  };

  const slotRow = (axis: Axis, slot: Slot, captured: ICalibrationSample | null) => (
    <div className="calib__slot">
      <label className="field">
        <span>{axis === 'pan' ? 'Observed bearing (°)' : 'Observed elevation (°)'}</span>
        <input
          value={deg[`${axis}${slot}`] ?? ''}
          onChange={(e) => setDeg((m) => ({ ...m, [`${axis}${slot}`]: e.target.value }))}
          inputMode="numeric"
          placeholder={axis === 'pan' ? '0 = forward' : '0 = level'}
        />
      </label>
      <button type="button" className="btn btn--ghost" onClick={() => capture(axis, slot)}>
        Capture point {slot + 1}
      </button>
      <span className="mono calib__val">
        {captured ? `n=${captured.normalized.toFixed(2)} @ ${captured.deg}°` : 'not captured'}
      </span>
    </div>
  );

  return (
    <div className="cameras calib">
      <header className="page-head">
        <button type="button" className="btn btn--ghost" onClick={() => onDone(false)}>
          ‹ Cameras
        </button>
        <div>
          <h1>Calibrate {name}</h1>
          <div className="page-head__sub">
            Aim at two known bearings per axis, then capture each.
          </div>
        </div>
      </header>

      <div className="chip chip--caution">
        Calibration is a static map — re-run it after the camera is remounted or if the mount sags.
      </div>
      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}

      <div className="panel">
        <div className="page-head__sub">Aim the camera</div>
        <div className="dock__group calib__pad">
          <button
            type="button"
            className="iconbtn"
            onClick={() => nudge({ pan: -0.3 })}
            aria-label="Pan left"
          >
            ◀
          </button>
          <button
            type="button"
            className="iconbtn"
            onClick={() => nudge({ tilt: 0.3 })}
            aria-label="Tilt up"
          >
            ▲
          </button>
          <button
            type="button"
            className="iconbtn"
            onClick={() => nudge({ tilt: -0.3 })}
            aria-label="Tilt down"
          >
            ▼
          </button>
          <button
            type="button"
            className="iconbtn"
            onClick={() => nudge({ pan: 0.3 })}
            aria-label="Pan right"
          >
            ▶
          </button>
          <button
            type="button"
            className="iconbtn iconbtn--stop"
            onClick={() => void ptzStop(id).catch(() => undefined)}
            aria-label="Stop"
          >
            STOP
          </button>
        </div>
        <p className="muted">Watch the camera (or its feed) as it moves to a known bearing.</p>
      </div>

      <div className="panel">
        <div className="page-head__sub">Pan</div>
        {slotRow('pan', 0, pan[0])}
        {slotRow('pan', 1, pan[1])}
      </div>
      <div className="panel">
        <div className="page-head__sub">Tilt</div>
        {slotRow('tilt', 0, tilt[0])}
        {slotRow('tilt', 1, tilt[1])}
      </div>

      <button type="button" className="btn" onClick={save} disabled={!ready || busy}>
        {busy ? 'Saving…' : ready ? 'Save calibration' : 'Capture all four points to save'}
      </button>
    </div>
  );
}
