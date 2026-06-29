import type { ICameraEntry } from '../api';
import { cameraSubtitle, cameraTileView } from '../lib/camera';

interface Props {
  camera: ICameraEntry;
  hero?: boolean;
}

/**
 * A Live Wall tile rendered on the near-black video mat. Until stream health (and the player) are
 * wired in, it shows the camera's identity and an honest "Connecting…" / "Disabled" state rather than
 * a fabricated live picture.
 */
export function CameraTile({ camera, hero }: Props) {
  const view = cameraTileView(camera);
  const subtitle = cameraSubtitle(camera);
  return (
    <div
      className={`tile${hero ? ' mosaic__hero' : ''}${view.dim ? ' tile--dark' : ''}`}
      aria-label={`${camera.name}${subtitle ? ` — ${subtitle}` : ''} — ${view.label}`}
    >
      <div className="tile__sheen" />
      <div className="tile__scrim" />
      <div className="tile__top">
        <span className="chip chip--neutral">{view.label}</span>
      </div>
      <div className="tile__label">
        <div className="tile__name">{camera.name}</div>
        {subtitle && <div className="tile__meta">{subtitle}</div>}
      </div>
    </div>
  );
}
