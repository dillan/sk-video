import type { IMobStatus } from '../api';
import { type IVesselState, formatLatLon, formatBearing } from '../lib/format';

interface Props {
  vessel: IVesselState | null;
  mob: IMobStatus | null;
  /** Number of cameras currently recording — shown as a red "N rec" when non-zero. */
  recordingCount?: number;
  /** Hardware-tier label (e.g. "Pi 4") for the right-edge badge. */
  tierLabel?: string;
}

/**
 * The glanceable helm status strip: GPS fix, position, heading, SOG, the active-record count, and the
 * hardware tier — plus the MOB state when armed. Honest about missing data: no fix shows an amber
 * "No GPS fix", and heading/SOG are omitted when unknown rather than shown as zero.
 */
export function TelemetryStrip({ vessel, mob, recordingCount = 0, tierLabel }: Props) {
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
      {mob?.active && <span className="chip chip--live">MOB ACTIVE</span>}
    </div>
  );
}
