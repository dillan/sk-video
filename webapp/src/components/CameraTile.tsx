import { useEffect, useRef, useState } from 'react';
import type { ICameraEntry, IStreamHealth, ITransportHints, TTransport } from '../api';
import {
  cameraSubtitle,
  tileStatus,
  tileCategory,
  healthPresence,
  type TileCategory,
} from '../lib/camera';
import { VideoPlayer } from './VideoPlayer';
import { H264_TRANSPORTS, transportLabel } from '../lib/transport';

interface Props {
  camera: ICameraEntry;
  /** Server transport walk from the wall projection; drives main-variant tiles when present. */
  transport?: ITransportHints | null;
  /** Server health (+last-good) from the projection; enriches the No-signal chip tooltip. */
  health?: IStreamHealth | null;
  hero?: boolean;
  /** When provided, the tile is a button that opens Camera Focus for this camera. */
  onOpen?: (id: string) => void;
  /** Reports the tile's coarse state so the wall header can tally live/still-refresh/offline. */
  onState?: (id: string, category: TileCategory) => void;
}

/** How long a tile waits for a first frame before it honestly reports "No signal". */
const SIGNAL_GRACE_MS = 10_000;

const CHIP_TONE = {
  live: 'chip--live',
  caution: 'chip--caution',
  neutral: 'chip--neutral',
} as const;

/**
 * A Live Wall tile on the near-black video mat. An enabled camera plays its low-res H.264 sub-stream
 * (substream-in-grid). The status chip is driven by the player's own activity — "Live" once a frame is
 * flowing, "Connecting…" while it negotiates, and "No signal" after a grace period with no frame (so a
 * dead camera never reads "Connecting…" forever). Tapping opens Camera Focus.
 */
export function CameraTile({ camera, transport, health, hero, onOpen, onState }: Props) {
  const subtitle = cameraSubtitle(camera);
  const [rung, setRung] = useState<TTransport>('mjpeg');
  const [active, setActive] = useState(false);
  const [signalLost, setSignalLost] = useState(false);
  // Lazy start: only a visible tile negotiates a stream; scrolling it off-screen unmounts the
  // player (closing its PeerConnection / stopping the still-refresh). Environments without
  // IntersectionObserver (jsdom) start every tile — the observer is an optimisation, not a gate.
  const rootRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: '120px' }, // pre-start just before the tile scrolls in, so it feels instant
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Prefer the captured H.264 sub-stream for the grid; fall back to main for a camera without one.
  const variant = camera.capabilities?.substreams && camera.media?.substreamPath ? 'sub' : 'main';
  // The sub-stream is H.264 by selection, so its walk is the H.264 one; a main-variant tile follows
  // the server-computed walk from the projection (codec-aware, e.g. HLS-first for an H.265 main).
  const walk = variant === 'main' && transport ? transport.recommended : H264_TRANSPORTS;

  // Arm the "No signal" grace timer while connecting; a frame (active) or a source change resets it.
  // An off-screen (lazily paused) tile is not connecting, so it must never age into "No signal".
  useEffect(() => {
    if (!camera.enabled || active || !visible) {
      setSignalLost(false);
      return;
    }
    const t = setTimeout(() => setSignalLost(true), SIGNAL_GRACE_MS);
    return () => clearTimeout(t);
  }, [camera.enabled, camera.id, variant, active, visible]);

  // Report the coarse state up so the Live Wall header can tally it.
  const category = tileCategory(camera, active, signalLost, rung);
  useEffect(() => {
    onState?.(camera.id, category);
  }, [camera.id, category, onState]);

  const status = tileStatus(camera, active, signalLost);
  const className = `tile${hero ? ' mosaic__hero' : ''}${status.dim ? ' tile--dark' : ''}`;
  const label = `${camera.name}${subtitle ? ` — ${subtitle}` : ''} — ${status.label}`;
  const body = (
    <>
      {camera.enabled && visible ? (
        <VideoPlayer
          cameraId={camera.id}
          transports={walk}
          variant={variant}
          onRung={setRung}
          onActive={setActive}
        />
      ) : (
        <div className="tile__sheen" />
      )}
      <div className="tile__scrim" />
      <div className="tile__top">
        <span
          className={`chip ${CHIP_TONE[status.tone]}`}
          // On a dead tile, say when the camera was last seen live (or that it never was).
          title={!status.live && health ? healthPresence(health).label : undefined}
        >
          {status.label}
          {status.live && <span className="mono"> · {transportLabel(rung)}</span>}
        </span>
      </div>
      <div className="tile__label">
        <div className="tile__name">{camera.name}</div>
        {subtitle && <div className="tile__meta">{subtitle}</div>}
      </div>
    </>
  );
  if (onOpen) {
    return (
      <button
        type="button"
        ref={rootRef as React.RefObject<HTMLButtonElement>}
        className={className}
        aria-label={label}
        onClick={() => onOpen(camera.id)}
      >
        {body}
      </button>
    );
  }
  return (
    <div ref={rootRef as React.RefObject<HTMLDivElement>} className={className} aria-label={label}>
      {body}
    </div>
  );
}
