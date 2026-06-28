import type { IRouter, Request, Response } from 'express';
import type { TCameraScheme, TCameraProjection } from '../cameras/camera-validation';

/**
 * Curated onboarding hints for action cameras and 360 cameras (GoPro / Insta360). These devices are
 * OPPORTUNISTIC, not a permanent marine install — they live on their own WiFi access point, need
 * external power, and their live-stream paths are vendor-quirky or reverse-engineered. The plugin
 * supplies the known AP address, pre-fillable sources (using already-allow-listed schemes — no new
 * go2rtc source type), and an HONEST list of caveats so the onboarding UX never oversells them.
 */

export interface IOnboardingSource {
  label: string;
  scheme: TCameraScheme;
  host: string;
  port?: number;
  path?: string;
  /** Pre-fill the camera's media.projection for a 360 source (A2). */
  projection?: TCameraProjection;
}

export interface IDeviceHint {
  key: string;
  make: string;
  models: string[];
  /** The device's own WiFi access-point address — join its AP, then it is reachable here. */
  apHost: string;
  /** Pre-fillable sources; may be EMPTY when the device only supports pushing (e.g. GoPro). */
  sources: IOnboardingSource[];
  /** Honest limitations — opportunistic, never a permanent install. */
  caveats: string[];
}

const HINTS: IDeviceHint[] = [
  {
    key: 'insta360-x',
    make: 'Insta360',
    models: ['X3', 'X4', 'X5'],
    apHost: '192.168.42.1',
    sources: [
      {
        label: 'WiFi 360 preview (RTSP)',
        scheme: 'rtsp',
        host: '192.168.42.1',
        port: 8554,
        path: '/live',
        projection: 'equirectangular',
      },
    ],
    caveats: [
      'The WiFi preview is reverse-engineered and lower-resolution (~1440×720), not the full recording quality.',
      'USB-UVC ingest suffers timestamp drift.',
      'The official Open Spherical Camera (OSC) API is control-only — it provides no live stream.',
      'Opportunistic, not a permanent install: the camera must stay on its AP and externally powered.',
    ],
  },
  {
    key: 'gopro-hero',
    make: 'GoPro',
    models: ['HERO12 Black', 'HERO13 Black'],
    apHost: '10.5.5.9',
    // No clean pull source: a GoPro streams by PUSHING (GoPro Labs RTMP) or via a keepalive'd UDP
    // preview, so there is nothing to pre-fill as a pull URL.
    sources: [],
    caveats: [
      'No clean pull source: use GoPro Labs to PUSH RTMP to a local RTMP target (e.g. MediaMTX), then add that rtmp:// URL as a camera.',
      'GoPro Labs RTMP auto-reconnect is limited — expect to restart the stream after a drop.',
      'The UDP preview needs external power and a ~2.5 s keepalive to stay alive.',
      'Opportunistic, not a permanent install.',
    ],
  },
];

function clone(hint: IDeviceHint): IDeviceHint {
  return {
    ...hint,
    models: [...hint.models],
    sources: hint.sources.map((s) => ({ ...s })),
    caveats: [...hint.caveats],
  };
}

/** All curated device onboarding hints (defensive copies). */
export function deviceHints(): IDeviceHint[] {
  return HINTS.map(clone);
}

/** One hint by key, or null. */
export function deviceHint(key: string): IDeviceHint | null {
  const found = HINTS.find((h) => h.key === key);
  return found ? clone(found) : null;
}

/** Registers the read-only `GET /cameras/onboarding-hints` convenience endpoint (static data). */
export function registerOnboardingHintsRoute(router: IRouter): void {
  router.get('/cameras/onboarding-hints', (_req: Request, res: Response) => {
    res.json({ hints: deviceHints() });
  });
}
