import { useEffect, useState } from 'react';
import type { ICameraEntry, TTransport } from '../api';
import { cameraSubtitle, tileStatus } from '../lib/camera';
import { VideoPlayer } from './VideoPlayer';
import { H264_TRANSPORTS, transportLabel } from '../lib/transport';

interface Props {
  camera: ICameraEntry;
  hero?: boolean;
  /** When provided, the tile is a button that opens Camera Focus for this camera. */
  onOpen?: (id: string) => void;
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
export function CameraTile({ camera, hero, onOpen }: Props) {
  const subtitle = cameraSubtitle(camera);
  const [rung, setRung] = useState<TTransport>('mjpeg');
  const [active, setActive] = useState(false);
  const [signalLost, setSignalLost] = useState(false);
  // Prefer the captured H.264 sub-stream for the grid; fall back to main for a camera without one.
  const variant = camera.capabilities?.substreams && camera.media?.substreamPath ? 'sub' : 'main';

  // Arm the "No signal" grace timer while connecting; a frame (active) or a source change resets it.
  useEffect(() => {
    if (!camera.enabled || active) {
      setSignalLost(false);
      return;
    }
    const t = setTimeout(() => setSignalLost(true), SIGNAL_GRACE_MS);
    return () => clearTimeout(t);
  }, [camera.enabled, camera.id, variant, active]);

  const status = tileStatus(camera, active, signalLost);
  const className = `tile${hero ? ' mosaic__hero' : ''}${status.dim ? ' tile--dark' : ''}`;
  const label = `${camera.name}${subtitle ? ` — ${subtitle}` : ''} — ${status.label}`;
  const body = (
    <>
      {camera.enabled ? (
        <VideoPlayer
          cameraId={camera.id}
          transports={H264_TRANSPORTS}
          variant={variant}
          onRung={setRung}
          onActive={setActive}
        />
      ) : (
        <div className="tile__sheen" />
      )}
      <div className="tile__scrim" />
      <div className="tile__top">
        <span className={`chip ${CHIP_TONE[status.tone]}`}>
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
        className={className}
        aria-label={label}
        onClick={() => onOpen(camera.id)}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={className} aria-label={label}>
      {body}
    </div>
  );
}
