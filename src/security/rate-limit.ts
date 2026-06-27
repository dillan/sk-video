/**
 * A small sliding-window rate limiter keyed by an arbitrary string (e.g. client IP). It guards the
 * brute-force-able surfaces — the connection test and the write-only credential endpoints — and slows
 * camera enumeration through the credential-presence read. Pure and clock-injectable so it is fully
 * unit-testable; no timers, no global state.
 */

export interface IRateLimitResult {
  ok: boolean;
  /** Milliseconds until the caller may retry (0 when allowed). */
  retryAfterMs: number;
}

export interface IRateLimiterOptions {
  /** Max allowed requests per key within the window. */
  max: number;
  windowMs: number;
  now?: () => number;
}

export class RateLimiter {
  /** Per-key timestamps of requests still within the current window. */
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: IRateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;
    this.now = options.now ?? (() => Date.now());
  }

  /** Records a request for `key` and reports whether it is allowed. */
  check(key: string): IRateLimitResult {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterMs: Math.max(0, recent[0] + this.windowMs - now) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true, retryAfterMs: 0 };
  }
}
