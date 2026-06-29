import type { IMobStatus } from '../api';
import { type IVesselState, formatLatLon, formatBearing } from '../lib/format';

interface Props {
  vessel: IVesselState | null;
  mob: IMobStatus | null;
}

/**
 * The glanceable helm strip: GPS fix, position, heading, SOG — and the MOB state when armed. Honest
 * about missing data: no fix shows an amber "No GPS fix", and heading/SOG are omitted when unknown
 * rather than shown as zero.
 */
export function TelemetryStrip({ vessel, mob }: Props) {
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
      {mob?.active && <span className="chip chip--live">MOB ACTIVE</span>}
    </div>
  );
}
