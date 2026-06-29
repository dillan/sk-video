import { useEffect, useState } from 'react';
import { fetchCameras, fetchVesselSelf, type ICameraEntry, type IMobStatus } from '../api';
import { parseVesselState, type IVesselState } from '../lib/format';
import { TelemetryStrip } from '../components/TelemetryStrip';
import { CameraTile } from '../components/CameraTile';

type Cams =
  | { state: 'loading' }
  | { state: 'ready'; cameras: ICameraEntry[] }
  | { state: 'error'; message: string };

/**
 * The hero surface: a glanceable mosaic of the boat's cameras, arranged with the first as the hero
 * tile. Cameras come from the shared Signal K resource; the telemetry strip from vessels/self. Live
 * video + the rich per-tile states (LIVE / still-refresh / went dark) arrive with the player + health
 * wiring; until then tiles show identity + an honest "Connecting…" state.
 */
export function LiveWall({ mob }: { mob: IMobStatus | null }) {
  const [cams, setCams] = useState<Cams>({ state: 'loading' });
  const [vessel, setVessel] = useState<IVesselState | null>(null);

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
    return () => ctrl.abort();
  }, []);

  const count =
    cams.state === 'ready'
      ? `${cams.cameras.length} ${cams.cameras.length === 1 ? 'camera' : 'cameras'}`
      : cams.state === 'loading'
        ? 'Loading cameras…'
        : 'Cameras unavailable';

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Live</h1>
          <div className="page-head__sub">{count}</div>
        </div>
        <div className="page-head__spacer" />
        <TelemetryStrip vessel={vessel} mob={mob} />
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
            <CameraTile key={c.id} camera={c} hero={i === 0} />
          ))}
        </div>
      )}
    </>
  );
}
