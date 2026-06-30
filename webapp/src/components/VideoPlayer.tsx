import { useEffect, useRef, useState } from 'react';
import { frameUrl, hlsUrl, whepUrl, type TTransport, type TStreamVariant } from '../api';
import { nextTransport } from '../lib/transport';

/**
 * Same-origin player driven by the server's transport walk (webrtc → hls → mjpeg, reordered for
 * H.265). It starts at the top rung and falls back on error/stall. Everything stays proxied: the
 * browser only ever talks to /plugins/sk-video/* — never go2rtc or a camera directly.
 *
 * Rungs: MJPEG is a still-refresh <img> loop (always works through frame.jpeg); HLS uses the native
 * player where supported (Safari) and otherwise falls back (hls.js is a later, lazy addition); WebRTC
 * is a WHEP negotiation. The rung-selection/fallback orchestration is unit-tested; live media playback
 * is verified against the e2e harness (a real go2rtc + stream), not in unit tests.
 */

const MJPEG_INTERVAL_MS = 1200;

interface Props {
  cameraId: string;
  transports: TTransport[];
  /** Which stream to play: the full-res main, or the low-res H.264 `sub` (for an H.265 main). */
  variant?: TStreamVariant;
  /** Notified when the active rung changes, so the caller can label it ("WebRTC" / "still-refresh"). */
  onRung?: (t: TTransport) => void;
  /** Notified when a real frame starts/stops playing — the honest "is this live?" signal for a tile. */
  onActive?: (active: boolean) => void;
}

async function negotiateWhep(
  id: string,
  video: HTMLVideoElement,
  variant: TStreamVariant,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection();
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    video.srcObject = e.streams[0] ?? null;
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(whepUrl(id, variant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    credentials: 'include',
    body: offer.sdp ?? '',
  });
  if (!res.ok) {
    pc.close();
    throw new Error(`whep ${res.status}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  return pc;
}

export function VideoPlayer({ cameraId, transports, variant = 'main', onRung, onActive }: Props) {
  const [rung, setRung] = useState<TTransport>(() => transports[0] ?? 'mjpeg');
  const [frameTick, setFrameTick] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Held in a ref so firing it never re-runs the binding effects (the parent may pass a fresh closure).
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  // Restart the walk whenever the camera, the recommended order, or the stream variant changes.
  useEffect(() => {
    setRung(transports[0] ?? 'mjpeg');
  }, [cameraId, transports, variant]);

  // Until the new source actually paints a frame, it is not "live" — reset on every source/rung change.
  useEffect(() => {
    onActiveRef.current?.(false);
  }, [cameraId, variant, rung]);

  useEffect(() => {
    onRung?.(rung);
  }, [rung, onRung]);

  const advance = (): void => setRung((cur) => nextTransport(transports, cur) ?? cur);

  // MJPEG still-refresh: bump a counter to cache-bust the <img> src on a timer.
  useEffect(() => {
    if (rung !== 'mjpeg') return;
    const iv = setInterval(() => setFrameTick((n) => n + 1), MJPEG_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [rung]);

  // HLS / WebRTC binding into the <video>, with cleanup on rung/camera change.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || (rung !== 'hls' && rung !== 'webrtc')) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;

    if (rung === 'hls') {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl(cameraId, variant);
      } else {
        // No native HLS and hls.js not yet bundled — fall back to the still-refresh rung.
        advance();
      }
    } else if (typeof RTCPeerConnection === 'undefined') {
      advance();
    } else {
      negotiateWhep(cameraId, video, variant)
        .then((conn) => {
          if (cancelled) conn.close();
          else pc = conn;
        })
        .catch(() => {
          if (!cancelled) advance();
        });
    }

    return () => {
      cancelled = true;
      if (pc) pc.close();
      video.srcObject = null;
      video.removeAttribute('src');
    };
    // advance/transports are stable enough for this effect; rung+cameraId+variant drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rung, cameraId, variant]);

  return (
    <div className="player">
      {rung === 'mjpeg' ? (
        <img
          className="player__media"
          src={frameUrl(cameraId, frameTick, variant)}
          alt=""
          onLoad={() => onActiveRef.current?.(true)}
          onError={() => {
            onActiveRef.current?.(false);
            advance();
          }}
        />
      ) : (
        <video
          className="player__media"
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onPlaying={() => onActiveRef.current?.(true)}
          onError={() => {
            onActiveRef.current?.(false);
            advance();
          }}
        />
      )}
    </div>
  );
}
