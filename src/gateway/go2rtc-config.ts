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
  /**
   * Explicit WebRTC ICE host candidates to advertise (`ip:port`), for hosts where go2rtc can't
   * auto-detect a browser-reachable address — e.g. behind NAT, on a multi-homed host, or inside a
   * container whose own interface IP the browser can't reach. Left empty by default (auto-detect).
   */
  webrtcCandidates?: string[];
  /**
   * Opt-in hardware transcoding. When true, an H.265 camera that has NO H.264 sub-stream gains a
   * GPU-accelerated H.264 transcode source so the browser can play it over WebRTC using the GPU
   * instead of pegging a CPU core (the exact case that otherwise falls to the MJPEG still-refresh
   * floor). Off by default — go2rtc's own guidance is that hardware transcoding can be unstable, and a
   * misdetected engine is worse than software. See {@link hardwareH264Source}.
   */
  hardwareAcceleration?: boolean;
}

/**
 * A go2rtc source that transcodes an RTSP URL to H.264 using auto-detected hardware. The bare
 * `#hardware` flag lets go2rtc pick the engine (VAAPI / v4l2m2m / videotoolbox / …) and, per its
 * docs, fall back to a software DECODER where the input codec isn't hardware-decodable — so on a Pi
 * (which "always uses software decoder") the win is the H.264 ENCODE offload, not the H.265 decode.
 * go2rtc only transcodes to H.264 (`#video=h265` is unsupported upstream), which is all the browser
 * needs. The URL comes from {@link buildGo2rtcSource} (validated scheme + host, no `#` possible in a
 * camera path), and the modifiers are constant, so this deliberate `ffmpeg:` source carries no more
 * risk than the plain URL it wraps.
 */
export function hardwareH264Source(rtspUrl: string): string {
  return `ffmpeg:${rtspUrl}#video=h264#hardware`;
}

/**
 * Whether {@link buildGo2rtcConfig} will give this camera a hardware H.264 transcode source: opt-in
 * acceleration is on AND it's an H.265 camera with no H.264 sub-stream. The transport walk must key off
 * the SAME predicate to lead with WebRTC — otherwise the client strands on the MJPEG floor and never
 * reaches the transcode. Kept here so the config and the walk can never drift apart.
 */
export function hasHardwareTranscodeSource(
  camera: ICamera,
  hardwareAcceleration: boolean,
): boolean {
  return hardwareAcceleration && camera.media?.codec === 'h265' && !camera.media?.substreamPath;
}

/**
 * Builds the go2rtc configuration object. The API (and thus the web UI) is bound to loopback so only
 * this plugin can reach it; the plugin proxies playback to the browser. Only enabled cameras become
 * streams, keyed by their resource id, with credentials embedded server-side.
 */
export function buildGo2rtcConfig(input: IGo2rtcConfigInput): Record<string, unknown> {
  const ports = input.ports ?? DEFAULT_GO2RTC_PORTS;

  // A stream value is either one source URL or, when the camera has a substream, an array go2rtc
  // uses for PARTIAL failover (main first, sub as fallback — not make-before-break).
  const streams: Record<string, string | string[]> = {};
  for (const [id, camera] of Object.entries(input.cameras)) {
    if (!camera.enabled) {
      continue;
    }
    const creds = input.credentials[id];
    const main = buildGo2rtcSource(camera, creds);
    const subPath = camera.media?.substreamPath;
    if (subPath) {
      const sub = buildGo2rtcSource(camera, creds, subPath);
      streams[id] = [main, sub]; // failover source list for the primary stream
      // A distinct stream for explicit low-res access (`/cameras/:id/whep?variant=sub`). The `_sub`
      // suffix can never collide with a real camera id, which forbids underscores. Credentials are
      // injected server-side here exactly as for the main stream.
      streams[`${id}_sub`] = sub;
    } else if (hasHardwareTranscodeSource(camera, input.hardwareAcceleration === true)) {
      // H.265 with no H.264 sub-stream: the browser can't play it over WebRTC, so go2rtc must
      // transcode. Offer the raw H.265 main (HLS/passthrough) AND a hardware H.264 transcode source
      // that go2rtc serves to a WebRTC client — moving this camera off the CPU-heavy MJPEG floor.
      streams[id] = [main, hardwareH264Source(main)];
    } else {
      streams[id] = main;
    }
  }

  const candidates = (input.webrtcCandidates ?? []).filter((c) => c.trim().length > 0);
  return {
    api: { listen: `127.0.0.1:${ports.api}` },
    rtsp: { listen: `127.0.0.1:${ports.rtsp}` },
    webrtc: {
      listen: `:${ports.webrtc}`,
      ...(candidates.length ? { candidates } : {}),
    },
    log: { level: 'warn' },
    streams,
  };
}
