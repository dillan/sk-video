/**
 * A concurrent-WebRTC budget for many-camera grids on Pi-class hosts: each PeerConnection costs the
 * server an encoder/forwarder and the client decode + ICE sockets, so an unbounded wall melts both.
 * Players must acquire a slot before negotiating WHEP; a denied player falls down its transport walk
 * (HLS/MJPEG still show frames) and retries the top rung later via the normal upgrade path — so the
 * budget degrades quality, never coverage.
 */

const DEFAULT_MAX = 6;

let max = DEFAULT_MAX;
let active = 0;

/** Take a slot if one is free. Callers MUST release exactly once per successful acquire. */
export function tryAcquireWebrtc(): boolean {
  if (active >= max) {
    return false;
  }
  active += 1;
  return true;
}

export function releaseWebrtc(): void {
  active = Math.max(0, active - 1);
}

export function activeWebrtcCount(): number {
  return active;
}

/** Test/tuning hook; resets the active count too. */
export function configureWebrtcBudget(newMax: number = DEFAULT_MAX): void {
  max = newMax;
  active = 0;
}
