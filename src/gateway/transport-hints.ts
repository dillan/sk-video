import type { IStreamHealth } from './stream-health';

/**
 * Adaptive transport contract (A5). The server exposes a recommended transport WALK so the KIP widget
 * can start at the lowest-latency option and fall back automatically on a starved marina link. This
 * is the SERVER-SIDE contract only — the actual walk + recovery UX is the widget's. It is NOT a true
 * ABR ladder; MJPEG is a still-refresh (single frames on a loop), not continuous video.
 */

export const TRANSPORTS = ['webrtc', 'hls', 'mjpeg'] as const;
export type TTransport = (typeof TRANSPORTS)[number];

export interface ITransportHints {
  /** Order to try; the client walks it on stall and recovers. */
  recommended: TTransport[];
  /** Negotiated codec names from go2rtc (drives the order). */
  codecs: string[];
  online: boolean;
  note: string;
}

const NOTE =
  'Client-side fallback order — the widget walks it on stall and recovers automatically. MJPEG is a still-refresh (frames on a loop), not continuous video; this is not an ABR ladder.';

/** Extra signals that reorder the walk beyond the negotiated codecs. */
export interface ITransportHintOptions {
  /**
   * The server has added a hardware H.264 transcode source for this camera (opt-in acceleration for an
   * H.265 camera with no H.264 sub-stream). That source is reachable ONLY over WebRTC, so WebRTC must
   * lead — otherwise the client's downward walk strands on the MJPEG floor and never reaches it.
   */
  hardwareTranscode?: boolean;
}

/** Recommend a transport walk for a camera, ordered by the codecs go2rtc negotiated. */
export function transportHints(
  health: IStreamHealth,
  opts: ITransportHintOptions = {},
): ITransportHints {
  const hasH265 = health.codecs.some((c) => /h\.?265|hevc/i.test(c));
  // WebRTC is lowest-latency and broadly supported; HLS is the robust fallback; MJPEG still-refresh is
  // the last resort that survives a starved link. Browser WebRTC/HLS support for H.265 is spotty, so
  // for an H.265 stream put the more-compatible options first — UNLESS a hardware H.264 transcode
  // source exists, in which case WebRTC now serves browser-friendly H.264 and must lead.
  const demoteWebrtc = hasH265 && !opts.hardwareTranscode;
  const recommended: TTransport[] = demoteWebrtc
    ? ['hls', 'mjpeg', 'webrtc']
    : ['webrtc', 'hls', 'mjpeg'];
  return { recommended, codecs: health.codecs, online: health.online, note: NOTE };
}
