import type { TTransport } from '../api';

/** The server recommends a codec-aware walk (webrtc → hls → mjpeg, reordered for H.265). The player
 * starts at the top and falls back down on stall/error. These helpers keep that pure and testable. */

export function pickTransport(recommended: TTransport[]): TTransport {
  return recommended[0] ?? 'mjpeg';
}

/** The next rung after `current`, or null when there's nowhere left to fall back to. */
export function nextTransport(recommended: TTransport[], current: TTransport): TTransport | null {
  const i = recommended.indexOf(current);
  return i >= 0 && i + 1 < recommended.length ? recommended[i + 1] : null;
}

export function transportLabel(t: TTransport): string {
  switch (t) {
    case 'webrtc':
      return 'WebRTC';
    case 'hls':
      return 'HLS';
    case 'mjpeg':
      return 'still-refresh ~1 fps';
  }
}

/** Whether continuous PTZ should be disabled — true on the MJPEG still-refresh rung (panning a
 * ~1 fps feed near a dock is dangerous; the design greys continuous PTZ there). */
export const ptzDelayed = (t: TTransport): boolean => t === 'mjpeg';

/** True for an HEVC/H.265 codec name — the one browsers (notably Chrome) can't decode for live view. */
export function isHevc(codecs: string[]): boolean {
  return codecs.some((c) => /h\.?265|hevc/i.test(c));
}

/** The walk for a known-H.264 stream: WebRTC first (lowest latency, broadly decodable incl. Chrome). */
export const H264_TRANSPORTS: TTransport[] = ['webrtc', 'hls', 'mjpeg'];

/**
 * Which walk to actually play. The server's recommendation is derived from the MAIN stream's codec, so
 * an H.265 main yields an HLS-first, WebRTC-last order — correct for the main, but wrong once we switch
 * to the H.264 substream (where WebRTC is the best rung and Chrome can decode it). When playing the sub
 * we therefore use the H.264 order instead of the H.265-derived one.
 */
export function transportsForVariant(useSub: boolean, recommended: TTransport[]): TTransport[] {
  return useSub ? H264_TRANSPORTS : recommended;
}

/** Human label for a codec id — `h265` → "H.265" (so the UI never shows a bare "H265"). */
export function codecLabel(codec: string): string {
  switch (codec.toLowerCase()) {
    case 'h265':
      return 'H.265';
    case 'h264':
      return 'H.264';
    case 'mjpeg':
      return 'MJPEG';
    default:
      return codec.toUpperCase();
  }
}
