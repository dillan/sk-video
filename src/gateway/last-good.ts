/**
 * Per-camera "last seen producing" tracker, so the console can honestly distinguish a camera that
 * is idle (go2rtc connects lazily), one that has NEVER produced since the plugin started, and one
 * that went dark after being live. State is in-memory since plugin start — `trackedSince` gives the
 * horizon, so "never seen" is always scoped ("since HH:MM"), never an absolute claim about the
 * camera. Every health read (route or watchdog poll) stamps it; no extra polling is added.
 */

export interface ILastGood {
  /** Epoch ms when this camera last had an active producer; null = never since `trackedSince`. */
  lastGoodAt: number | null;
  /** Epoch ms when tracking began (plugin start) — the honest horizon for "never seen". */
  trackedSince: number;
}

export class LastGoodTracker {
  private readonly seen = new Map<string, number>();
  private readonly since: number;

  constructor(private readonly now: () => number = Date.now) {
    this.since = this.now();
  }

  /** Stamp a health observation; only an online reading updates the timestamp. */
  note(cameraId: string, online: boolean): void {
    if (online) {
      this.seen.set(cameraId, this.now());
    }
  }

  get(cameraId: string): ILastGood {
    return { lastGoodAt: this.seen.get(cameraId) ?? null, trackedSince: this.since };
  }

  /** Drop state for a removed camera so a re-added id starts honest. */
  forget(cameraId: string): void {
    this.seen.delete(cameraId);
  }
}
