/**
 * Guards the discovery scanner so it can't be abused: only one scan may run at a time, and a
 * cooldown must elapse between scans. Active LAN probing (WS-Discovery / mDNS) is multicast
 * amplification, so it must be rate-limited even for an authenticated caller.
 */
export class ScanThrottle {
  private inFlight = false;
  private lastEnd = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when a new scan may start (none in flight and the cooldown has elapsed). */
  canScan(): boolean {
    return !this.inFlight && this.retryAfterMs() === 0;
  }

  /** Milliseconds until a scan may start again, or 0 if one may start now. */
  retryAfterMs(): number {
    if (this.lastEnd === Number.NEGATIVE_INFINITY) {
      return 0;
    }
    return Math.max(0, this.cooldownMs - (this.now() - this.lastEnd));
  }

  /** Marks a scan as started; throws if one is already running or the cooldown is active. */
  begin(): void {
    if (this.inFlight) {
      throw new Error('a discovery scan is already in progress');
    }
    const wait = this.retryAfterMs();
    if (wait > 0) {
      throw new Error(`discovery is cooling down; retry in ${wait}ms`);
    }
    this.inFlight = true;
  }

  /** Marks the running scan as finished and starts the cooldown clock. */
  end(): void {
    this.inFlight = false;
    this.lastEnd = this.now();
  }
}
