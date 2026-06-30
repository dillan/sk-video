import { useCallback, useEffect, useState } from 'react';
import {
  fetchCameras,
  fetchVesselSelf,
  fetchStatus,
  fetchRecordingTimeline,
  type ICameraEntry,
  type IMobStatus,
} from '../api';
import { parseVesselState, type IVesselState } from '../lib/format';
import { summarizeCategories, type TileCategory } from '../lib/camera';
import { TelemetryStrip } from '../components/TelemetryStrip';
import { CameraTile } from '../components/CameraTile';

type Cams =
  | { state: 'loading' }
  | { state: 'ready'; cameras: ICameraEntry[] }
  | { state: 'error'; message: string };

/**
 * The hero surface: a glanceable mosaic of the boat's cameras, arranged with the first as the hero
 * tile. Cameras come from the shared Signal K resource; the telemetry strip from vessels/self. Each
 * enabled tile plays its low-res H.264 sub-stream (substream-in-grid); the richer health states
 * (went-dark / never-seen) arrive with the per-camera health wiring.
 */
export function LiveWall({
  mob,
  onOpenCamera,
}: {
  mob: IMobStatus | null;
  onOpenCamera: (id: string) => void;
}) {
  const [cams, setCams] = useState<Cams>({ state: 'loading' });
  const [vessel, setVessel] = useState<IVesselState | null>(null);
  const [tier, setTier] = useState<string | undefined>();
  const [recording, setRecording] = useState(0);
  const [states, setStates] = useState<Record<string, TileCategory>>({});
  const onState = useCallback(
    (id: string, category: TileCategory) =>
      setStates((prev) => (prev[id] === category ? prev : { ...prev, [id]: category })),
    [],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchCameras(ctrl.signal)
      .then((cameras) => setCams({ state: 'ready', cameras }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setCams({ state: 'error', message: err instanceof Error ? err.message : 'unreachable' });
      });
    fetchVesselSelf(ctrl.signal)
      .then((raw) => setVessel(parseVesselState(raw)))
      .catch(() => setVessel({ hasFix: false }));
    fetchStatus(ctrl.signal)
      .then((s) => setTier(s.hardware?.label ?? s.hardware?.tier))
      .catch(() => undefined);
    fetchRecordingTimeline(ctrl.signal)
      .then((t) => setRecording(t.cameras.filter((c) => c.recording).length))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  let count: string;
  if (cams.state === 'ready') {
    const n = cams.cameras.length;
    const tally = summarizeCategories(cams.cameras.map((c) => states[c.id]).filter(Boolean));
    count = `${n} ${n === 1 ? 'camera' : 'cameras'}${tally ? ` · ${tally}` : ''}`;
  } else {
    count = cams.state === 'loading' ? 'Loading cameras…' : 'Cameras unavailable';
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Live</h1>
          <div className="page-head__sub">{count}</div>
        </div>
        <div className="page-head__spacer" />
        <TelemetryStrip vessel={vessel} mob={mob} recordingCount={recording} tierLabel={tier} />
      </header>

      {cams.state === 'loading' && (
        <div className="empty">
          <p className="muted">Connecting to your cameras…</p>
        </div>
      )}
      {cams.state === 'error' && (
        <div className="empty">
          <p className="chip chip--caution">Can’t load cameras ({cams.message})</p>
        </div>
      )}
      {cams.state === 'ready' && cams.cameras.length === 0 && (
        <div className="empty">
          <p>No cameras yet.</p>
          <p className="muted">Add a camera in Cameras to see it on the wall.</p>
        </div>
      )}
      {cams.state === 'ready' && cams.cameras.length > 0 && (
        <div className="mosaic">
          {cams.cameras.map((c, i) => (
            <CameraTile
              key={c.id}
              camera={c}
              hero={i === 0}
              onOpen={onOpenCamera}
              onState={onState}
            />
          ))}
        </div>
      )}
    </>
  );
}
