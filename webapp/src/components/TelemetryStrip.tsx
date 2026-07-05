import type { IMobStatus } from '../api';
import { type IVesselState, formatLatLon, formatBearing } from '../lib/format';
import type { TStreamState } from '../lib/sk-stream';

interface Props {
  vessel: IVesselState | null;
  mob: IMobStatus | null;
  /** Number of cameras currently recording — shown as a red "N rec" when non-zero. */
  recordingCount?: number;
  /** Hardware-tier label (e.g. "Pi 4") for the right-edge badge. */
  tierLabel?: string;
  /** Delta-stream link state; anything but live shows a stamped reconnecting chip. */
  link?: TStreamState;
  /** Epoch ms of the last successful sync — the honest "as of" stamp while reconnecting. */
  lastSyncAt?: number | null;
  /** Session lapsed (re-auth in flight): keep the last-known values but stamp them HELD, never blank
   *  or zero them — we can't confirm the safety state until the session comes back. */
  stale?: boolean;
}

/** HH:MM:SS for the as-of / armed-at stamps. */
const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour12: false });

/**
 * The glanceable helm status strip: GPS fix, position, heading, SOG, the active-record count, and the
 * hardware tier — plus the MOB state when armed (stamped with when it was armed). Honest about missing
 * data: no fix shows an amber "No GPS fix", heading/SOG are omitted when unknown rather than shown as
 * zero, and a dropped delta stream shows "reconnecting · as of HH:MM:SS" instead of silently going stale.
 */
export function TelemetryStrip({
  vessel,
  mob,
  recordingCount = 0,
  tierLabel,
  link,
  lastSyncAt,
  stale = false,
}: Props) {
  return (
    <div className="telemetry" role="status" aria-label="Vessel telemetry">
      {vessel?.hasFix ? (
        <>
          <span className="telemetry__item">
            <span className="dot dot--online" />
            fix
          </span>
          {vessel.lat !== undefined && vessel.lon !== undefined && (
            <span className="telemetry__item">{formatLatLon(vessel.lat, vessel.lon)}</span>
          )}
        </>
      ) : (
        <span className="chip chip--caution">No GPS fix</span>
      )}
      {vessel?.headingDeg !== undefined && (
        <span className="telemetry__item">
          <span className="muted">HDG</span>
          {formatBearing(vessel.headingDeg)}
        </span>
      )}
      {vessel?.sogKn !== undefined && (
        <span className="telemetry__item">
          <span className="muted">SOG</span>
          {vessel.sogKn.toFixed(1)}
          <span className="muted">kn</span>
        </span>
      )}
      {recordingCount > 0 && (
        <span className="telemetry__item">
          <span className="dot dot--rec" />
          {recordingCount}
          <span className="muted">rec</span>
        </span>
      )}
      {tierLabel && <span className="chip chip--neutral mono telemetry__tier">{tierLabel}</span>}
      {link === 'reconnecting' && (
        <span className="chip chip--caution">
          reconnecting{typeof lastSyncAt === 'number' ? ` · as of ${clock(lastSyncAt)}` : ''}
        </span>
      )}
      {mob?.active && (
        <span className="chip chip--live">
          MOB ACTIVE
          {typeof mob.armedAt === 'number' && <span className="mono"> · {clock(mob.armedAt)}</span>}
          {stale && <span className="mono"> · held</span>}
        </span>
      )}
      {stale && <span className="chip chip--caution">session held · sign in to refresh</span>}
    </div>
  );
}
