import { useEffect, useRef, useState } from 'react';
import { frameUrl, hlsUrl, whepUrl, type TTransport, type TStreamVariant } from '../api';
import { nextTransport, trackStall, upgradeDelayMs } from '../lib/transport';

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
// While the operator is actively driving PTZ we refresh the still-image far faster so movement is
// visible in near-real-time (bounded to the interaction window), instead of the ~1 fps idle cadence.
const MJPEG_ACTIVE_MS = 250;
// Stall watchdog: poll playback progress on the live rungs and walk down a transport if a feed freezes
// (or never starts). Generous timeout so a slow WHEP/HLS negotiation on a marina link isn't cut short.
const STALL_CHECK_MS = 2000;
const STALL_TIMEOUT_MS = 8000;
// How long the preferred rung must hold before we trust it and reset the upgrade-retry budget.
const UPGRADE_HOLD_MS = 5000;

interface Props {
  cameraId: string;
  transports: TTransport[];
  /** Which stream to play: the full-res main, or the low-res H.264 `sub` (for an H.265 main). */
  variant?: TStreamVariant;
  /** Notified when the active rung changes, so the caller can label it ("WebRTC" / "still-refresh"). */
  onRung?: (t: TTransport) => void;
  /** Notified when a real frame starts/stops playing — the honest "is this live?" signal for a tile. */
  onActive?: (active: boolean) => void;
  /** When true (e.g. a PTZ control is being driven), refresh the MJPEG floor fast for live feedback. */
  responsive?: boolean;
}

// go2rtc's WHEP is a single POST (non-trickle), so the browser's ICE candidates can only travel in the
// offer we send. Give gathering a brief, capped moment so the offer carries host candidates — a
// candidate-bearing offer connects far more reliably on marina wifi than a bare one that has to rely on
// peer-reflexive discovery. Capped low so it never adds meaningful latency to first frame.
const ICE_GATHER_CAP_MS = 400;
function waitForIceGathering(pc: RTCPeerConnection, capMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(finish, capMs);
  });
}

async function negotiateWhep(
  id: string,
  video: HTMLVideoElement,
  variant: TStreamVariant,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection();
  // Close the PeerConnection on ANY failure (offer/SDP/fetch), not just a bad response — otherwise a
  // reject mid-negotiation leaks a PC (and its ICE sockets) every fallback/retry.
  try {
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (e) => {
      video.srcObject = e.streams[0] ?? null;
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc, ICE_GATHER_CAP_MS);
    const res = await fetch(whepUrl(id, variant), {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      credentials: 'include',
      body: pc.localDescription?.sdp ?? offer.sdp ?? '',
    });
    if (!res.ok) {
      throw new Error(`whep ${res.status}`);
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    return pc;
  } catch (err) {
    pc.close();
    throw err;
  }
}

export function VideoPlayer({
  cameraId,
  transports,
  variant = 'main',
  onRung,
  onActive,
  responsive = false,
}: Props) {
  const [rung, setRung] = useState<TTransport>(() => transports[0] ?? 'mjpeg');
  const [frameTick, setFrameTick] = useState(0);
  // The last still-image frame we painted, kept as a poster so a rung switch (incl. an upgrade attempt)
  // shows the last view instead of blanking while the new transport negotiates.
  const [poster, setPoster] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const top = transports[0] ?? 'mjpeg';
  // Held in a ref so firing it never re-runs the binding effects (the parent may pass a fresh closure).
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  // How many times we've tried to climb back to the top rung this outage (resets once it holds).
  const upgradeTries = useRef(0);

  const markActive = (live: boolean): void => {
    setPlaying(live);
    onActiveRef.current?.(live);
  };

  // Restart the walk whenever the camera, the recommended order, or the stream variant changes.
  useEffect(() => {
    setRung(transports[0] ?? 'mjpeg');
    upgradeTries.current = 0;
  }, [cameraId, transports, variant]);

  // Until the new source actually paints a frame, it is not "live" — reset on every source/rung change.
  useEffect(() => {
    markActive(false);
  }, [cameraId, variant, rung]);

  useEffect(() => {
    onRung?.(rung);
  }, [rung, onRung]);

  const advance = (): void => setRung((cur) => nextTransport(transports, cur) ?? cur);

  // MJPEG still-refresh: bump a counter to cache-bust the <img> src on a timer — fast while a control is
  // being driven (`responsive`), otherwise the calm ~1 fps idle cadence.
  useEffect(() => {
    if (rung !== 'mjpeg') return;
    const iv = setInterval(
      () => setFrameTick((n) => n + 1),
      responsive ? MJPEG_ACTIVE_MS : MJPEG_INTERVAL_MS,
    );
    return () => clearInterval(iv);
  }, [rung, responsive]);

  // Recover UP: the walk only falls down, so a transient WebRTC miss (or a go2rtc restart) would strand
  // the feed on the 1 fps MJPEG floor. When we're below the preferred rung, re-attempt it on a backoff;
  // the poster keeps the last frame visible during the reconnect. Give up after the budget so a truly
  // WebRTC-broken camera settles instead of blipping. `top` is a stable string, so this doesn't churn.
  useEffect(() => {
    if (rung === top) return;
    const delay = upgradeDelayMs(upgradeTries.current);
    if (delay === null) return;
    const timer = setTimeout(() => {
      upgradeTries.current += 1;
      setRung(top);
    }, delay);
    return () => clearTimeout(timer);
  }, [rung, top]);

  // Once the preferred rung has held for a bit, trust it and refill the retry budget for next time.
  useEffect(() => {
    if (rung !== top) return;
    const t = setTimeout(() => {
      upgradeTries.current = 0;
    }, UPGRADE_HOLD_MS);
    return () => clearTimeout(t);
  }, [rung, top]);

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

  // Stall watchdog for the live rungs: if playback stops advancing (frozen, or never started — e.g. a
  // WebRTC that negotiates but gets no media on a starved link), walk down to the next transport. MJPEG
  // is the floor (it re-fetches frames on its own), so there's nothing to walk to from there.
  useEffect(() => {
    if (rung !== 'webrtc' && rung !== 'hls') return;
    let sample = { time: 0, at: performance.now() };
    const iv = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const r = trackStall(sample, video.currentTime, performance.now(), STALL_TIMEOUT_MS);
      sample = r.sample;
      if (r.stalled) advance();
    }, STALL_CHECK_MS);
    return () => clearInterval(iv);
    // advance is stable enough; rung/camera/variant restart the watchdog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rung, cameraId, variant]);

  const mjpegSrc = frameUrl(cameraId, frameTick, variant);

  return (
    <div className="player">
      {rung === 'mjpeg' ? (
        <img
          className="player__media"
          src={mjpegSrc}
          alt=""
          onLoad={() => {
            setPoster(mjpegSrc);
            markActive(true);
          }}
          onError={() => {
            markActive(false);
            advance();
          }}
        />
      ) : (
        <>
          <video
            className="player__media"
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onPlaying={() => markActive(true)}
            onError={() => {
              markActive(false);
              advance();
            }}
          />
          {/* Keep the last frame on screen while the video rung negotiates, so an upgrade never blanks. */}
          {!playing && poster && (
            <img className="player__media player__poster" src={poster} alt="" aria-hidden="true" />
          )}
        </>
      )}
    </div>
  );
}
