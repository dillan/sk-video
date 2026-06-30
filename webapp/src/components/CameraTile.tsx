import { useState } from 'react';
import type { ICameraEntry, TTransport } from '../api';
import { cameraSubtitle, cameraTileView } from '../lib/camera';
import { VideoPlayer } from './VideoPlayer';
import { H264_TRANSPORTS, transportLabel } from '../lib/transport';

interface Props {
  camera: ICameraEntry;
  hero?: boolean;
  /** When provided, the tile is a button that opens Camera Focus for this camera. */
  onOpen?: (id: string) => void;
}

/**
 * A Live Wall tile on the near-black video mat. An enabled camera plays its low-res H.264 sub-stream
 * (substream-in-grid): the sub is Pi-friendly and browser-decodable even when the main is H.265, so the
 * WebRTC-first walk fits. The active transport is labelled honestly (WebRTC / still-refresh ~1 fps); a
 * disabled camera shows a dimmed placeholder. Tapping opens Camera Focus (full-res, full controls).
 */
export function CameraTile({ camera, hero, onOpen }: Props) {
  const view = cameraTileView(camera);
  const subtitle = cameraSubtitle(camera);
  const [rung, setRung] = useState<TTransport>('mjpeg');
  // Prefer the captured H.264 sub-stream for the grid; fall back to main for a camera without one.
  const variant = camera.capabilities?.substreams && camera.media?.substreamPath ? 'sub' : 'main';
  const status = camera.enabled ? transportLabel(rung) : view.label;
  const className = `tile${hero ? ' mosaic__hero' : ''}${view.dim ? ' tile--dark' : ''}`;
  const label = `${camera.name}${subtitle ? ` — ${subtitle}` : ''} — ${status}`;
  const body = (
    <>
      {camera.enabled ? (
        <VideoPlayer
          cameraId={camera.id}
          transports={H264_TRANSPORTS}
          variant={variant}
          onRung={setRung}
        />
      ) : (
        <div className="tile__sheen" />
      )}
      <div className="tile__scrim" />
      <div className="tile__top">
        <span className="chip chip--neutral">{status}</span>
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
