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
