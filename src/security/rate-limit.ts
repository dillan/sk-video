/**
 * A small sliding-window rate limiter keyed by an arbitrary string (e.g. client IP). It guards the
 * brute-force-able surfaces — the connection test and the write-only credential endpoints — and slows
 * camera enumeration through the credential-presence read. Pure and clock-injectable so it is fully
 * unit-testable; no timers, no global state.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
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
  constructor(private readonly options: IRateLimiterOptions) {
    void this.options;
  }

  /** Records a request for `key` and reports whether it is allowed. */
  check(_key: string): IRateLimitResult {
    return { ok: true, retryAfterMs: 0 };
  }
}
