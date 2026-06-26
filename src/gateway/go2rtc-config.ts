import type { ICamera } from '../cameras/camera-validation';
import { buildGo2rtcSource, type ICameraCredentials } from './go2rtc-source';

export interface IGo2rtcPorts {
  /** go2rtc API/UI/WebSocket port — bound to loopback only. */
  api: number;
  /** go2rtc's RTSP server port — bound to loopback only. */
  rtsp: number;
  /** WebRTC port — must be reachable on the LAN for ICE. */
  webrtc: number;
}

export const DEFAULT_GO2RTC_PORTS: IGo2rtcPorts = { api: 1984, rtsp: 8554, webrtc: 8555 };

export interface IGo2rtcConfigInput {
  cameras: Record<string, ICamera>;
  credentials: Record<string, ICameraCredentials>;
  ports?: IGo2rtcPorts;
}

/**
 * Builds the go2rtc configuration object. The API (and thus the web UI) is bound to loopback so only
 * this plugin can reach it; the plugin proxies playback to the browser. Only enabled cameras become
 * streams, keyed by their resource id, with credentials embedded server-side.
 */
export function buildGo2rtcConfig(input: IGo2rtcConfigInput): Record<string, unknown> {
  const ports = input.ports ?? DEFAULT_GO2RTC_PORTS;

  const streams: Record<string, string> = {};
  for (const [id, camera] of Object.entries(input.cameras)) {
    if (camera.enabled) {
      streams[id] = buildGo2rtcSource(camera, input.credentials[id]);
    }
  }

  return {
    api: { listen: `127.0.0.1:${ports.api}` },
    rtsp: { listen: `127.0.0.1:${ports.rtsp}` },
    webrtc: { listen: `:${ports.webrtc}` },
    log: { level: 'warn' },
    streams,
  };
}
