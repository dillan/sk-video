import type { ICameraEntry } from '../api';
import { cameraSubtitle, cameraTileView } from '../lib/camera';

interface Props {
  camera: ICameraEntry;
  hero?: boolean;
  /** When provided, the tile is a button that opens Camera Focus for this camera. */
  onOpen?: (id: string) => void;
}

/**
 * A Live Wall tile rendered on the near-black video mat. Until stream health (and substream-in-grid
 * players) are wired in, it shows the camera's identity and an honest "Connecting…" / "Disabled"
 * state rather than a fabricated live picture. Tapping opens Camera Focus.
 */
export function CameraTile({ camera, hero, onOpen }: Props) {
  const view = cameraTileView(camera);
  const subtitle = cameraSubtitle(camera);
  const className = `tile${hero ? ' mosaic__hero' : ''}${view.dim ? ' tile--dark' : ''}`;
  const label = `${camera.name}${subtitle ? ` — ${subtitle}` : ''} — ${view.label}`;
  const body = (
    <>
      <div className="tile__sheen" />
      <div className="tile__scrim" />
      <div className="tile__top">
        <span className="chip chip--neutral">{view.label}</span>
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
