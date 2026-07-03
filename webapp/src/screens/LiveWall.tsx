import { useCallback, useEffect, useState } from 'react';
import { fetchCamerasProjection, type ILayoutGroup, type IProjectedCamera } from '../api';
import { summarizeCategories, type TileCategory } from '../lib/camera';
import { CameraTile } from '../components/CameraTile';

type Cams =
  | { state: 'loading' }
  | {
      state: 'ready';
      cameras: IProjectedCamera[];
      gatewayOnline: boolean;
      groups: ILayoutGroup[];
    }
  | { state: 'error'; message: string };

/**
 * The hero surface: a glanceable mosaic of the boat's cameras, arranged with the first as the hero
 * tile. One aggregate projection request carries definitions + per-camera health (went-dark /
 * never-seen) + the server transport walk, so the wall never fans out N health + N transport reads
 * over a marina link. Each enabled tile plays its low-res H.264 sub-stream (substream-in-grid).
 * The projection's layout groups (sectors, PTZ, safety, Unplaced) become filter chips when there is
 * more than one to pick between. Vessel telemetry / MOB / safety alerts live on the shell's
 * persistent strip, not here.
 */
export function LiveWall({ onOpenCamera }: { onOpenCamera: (id: string) => void }) {
  const [cams, setCams] = useState<Cams>({ state: 'loading' });
  const [states, setStates] = useState<Record<string, TileCategory>>({});
  // Group filter, in-memory only (a wall filter is a moment-to-moment choice, not a setting).
  // 'all' shows every camera, including any the layout groups omit (they cover enabled cameras only).
  // The selection persists per device (the v1 "saved view") — storage failures just lose persistence.
  const [group, setGroup] = useState(() => {
    try {
      return localStorage.getItem('sk-video.wall-group') ?? 'all';
    } catch {
      return 'all';
    }
  });
  const pickGroup = useCallback((key: string) => {
    setGroup(key);
    try {
      localStorage.setItem('sk-video.wall-group', key);
    } catch {
      /* persistence is best-effort */
    }
  }, []);
  const onState = useCallback(
    (id: string, category: TileCategory) =>
      setStates((prev) => (prev[id] === category ? prev : { ...prev, [id]: category })),
    [],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchCamerasProjection(ctrl.signal)
      .then((p) =>
        setCams({
          state: 'ready',
          cameras: p.cameras,
          gatewayOnline: p.gatewayOnline,
          groups: p.layout?.groups ?? [],
        }),
      )
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setCams({ state: 'error', message: err instanceof Error ? err.message : 'unreachable' });
      });
    return () => ctrl.abort();
  }, []);

  // Chips only earn their space when there is more than one real (non-'all') group to pick between —
  // a single sector that covers the whole wall would just be a second "All cameras".
  const realGroups = cams.state === 'ready' ? cams.groups.filter((g) => g.key !== 'all') : [];
  const showChips = realGroups.length > 1;
  const activeGroup = group === 'all' ? undefined : realGroups.find((g) => g.key === group);
  const shown =
    cams.state === 'ready'
      ? activeGroup
        ? cams.cameras.filter((c) => activeGroup.cameraIds.includes(c.id))
        : cams.cameras
      : [];

  let count: string;
  if (cams.state === 'ready') {
    const n = shown.length;
    const tally = summarizeCategories(shown.map((c) => states[c.id]).filter(Boolean));
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
      {showChips && (
        <nav className="seg" aria-label="Camera groups" style={{ marginBottom: 8 }}>
          <button
            type="button"
            className={`iconbtn iconbtn--wide${group === 'all' ? ' iconbtn--on' : ''}`}
            aria-pressed={group === 'all'}
            onClick={() => pickGroup('all')}
          >
            All cameras
          </button>
          {realGroups.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`iconbtn iconbtn--wide${group === g.key ? ' iconbtn--on' : ''}`}
              aria-pressed={group === g.key}
              onClick={() => pickGroup(g.key)}
            >
              {g.label}
            </button>
          ))}
        </nav>
      )}
      {cams.state === 'ready' && shown.length > 0 && (
        <div className="mosaic">
          {shown.map((c, i) => (
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
