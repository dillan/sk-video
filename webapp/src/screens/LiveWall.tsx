import { useCallback, useEffect, useState } from 'react';
import { fetchCamerasProjection, type IProjectedCamera } from '../api';
import { summarizeCategories, type TileCategory } from '../lib/camera';
import { CameraTile } from '../components/CameraTile';

type Cams =
  | { state: 'loading' }
  | { state: 'ready'; cameras: IProjectedCamera[]; gatewayOnline: boolean }
  | { state: 'error'; message: string };

/**
 * The hero surface: a glanceable mosaic of the boat's cameras, arranged with the first as the hero
 * tile. One aggregate projection request carries definitions + per-camera health (went-dark /
 * never-seen) + the server transport walk, so the wall never fans out N health + N transport reads
 * over a marina link. Each enabled tile plays its low-res H.264 sub-stream (substream-in-grid).
 * Vessel telemetry / MOB / safety alerts live on the shell's persistent strip, not here.
 */
export function LiveWall({ onOpenCamera }: { onOpenCamera: (id: string) => void }) {
  const [cams, setCams] = useState<Cams>({ state: 'loading' });
  const [states, setStates] = useState<Record<string, TileCategory>>({});
  const onState = useCallback(
    (id: string, category: TileCategory) =>
      setStates((prev) => (prev[id] === category ? prev : { ...prev, [id]: category })),
    [],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchCamerasProjection(ctrl.signal)
      .then((p) => setCams({ state: 'ready', cameras: p.cameras, gatewayOnline: p.gatewayOnline }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setCams({ state: 'error', message: err instanceof Error ? err.message : 'unreachable' });
      });
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
      {cams.state === 'ready' && !cams.gatewayOnline && (
        <div className="chip chip--caution" style={{ marginBottom: 8 }}>
          Video gateway is down — tiles will reconnect when it recovers.
        </div>
      )}
      {cams.state === 'ready' && cams.cameras.length > 0 && (
        <div className="mosaic">
          {cams.cameras.map((c, i) => (
            <CameraTile
              key={c.id}
              camera={c}
              transport={c.transport}
              health={c.health}
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
