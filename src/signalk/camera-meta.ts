import type { IMetaEntry } from './sk-bridge';

/**
 * Builds the Signal K metadata for a camera's health paths, so any client can label, scale, and
 * stale-flag them without knowing sk-video. The feed-outage gauge is the one path that can alarm:
 * when the user hands its alarm to the server (zones opt-in), the zones ride along here and the
 * server raises `notifications.cameras.<id>.feedOutage` itself — the same path the plugin's own
 * watchdog alarm uses, so the handover never moves the alarm.
 */

/** A zone row in Signal K meta form ({@link https://signalk.org/specification/1.7.0/doc/data_model_metadata.html}). */
export interface ICameraHealthZone {
  lower?: number;
  upper?: number;
  state: 'normal' | 'alert' | 'warn' | 'alarm' | 'emergency';
  message?: string;
}

/** The per-camera feed-outage gauge path (seconds since last confirmed-healthy poll). */
export function feedOutagePath(id: string): string {
  return `cameras.${id}.feedOutage`;
}

export interface ICameraHealthMetaOptions {
  id: string;
  /** The camera's human name (drives displayName). */
  name: string;
  /** The watchdog poll interval; meta.timeout is 2× this so clients can flag staleness. */
  pollSeconds: number;
  /** Server-evaluated alarm thresholds on the gauge — present only when the user opted in. */
  zones?: ICameraHealthZone[];
}

/** Map the user's two thresholds onto contiguous warn + alarm zones with human messages. */
export function zonesForThresholds(
  name: string,
  thresholds: { warnAfterSeconds: number; alarmAfterSeconds: number },
): ICameraHealthZone[] {
  return [
    {
      lower: thresholds.warnAfterSeconds,
      upper: thresholds.alarmAfterSeconds,
      state: 'warn',
      message: `${name} feed is stalling`,
    },
    { lower: thresholds.alarmAfterSeconds, state: 'alarm', message: `${name} has gone dark` },
  ];
}

/**
 * What a zones-enabled camera must emit BEFORE its resource is deleted: a final in-normal-zone
 * gauge value (so the server clears any active zone notification) and then a zones-clearing meta
 * (so the watcher disarms). Skipping this orphans a server-raised alarm the plugin cannot clear.
 */
export function buildCameraHealthTeardown(id: string): {
  finalValue: { path: string; value: number };
  clearZonesMeta: IMetaEntry;
} {
  return {
    finalValue: { path: feedOutagePath(id), value: 0 },
    clearZonesMeta: { path: feedOutagePath(id), value: { zones: null } },
  };
}

export function buildCameraHealthMeta(options: ICameraHealthMetaOptions): IMetaEntry[] {
  const { id, name, pollSeconds, zones } = options;
  return [
    {
      path: feedOutagePath(id),
      value: {
        displayName: `${name} — feed outage`,
        description: 'Seconds since this camera last produced video.',
        units: 's',
        timeout: pollSeconds * 2,
        ...(zones && zones.length > 0 ? { zones } : {}),
      },
    },
    {
      path: `cameras.${id}.producers`,
      value: { displayName: `${name} — producers` },
    },
    {
      path: `cameras.${id}.consumers`,
      value: { displayName: `${name} — viewers` },
    },
  ];
}
