import {
  normalizeDiscovery,
  type ICameraCandidate,
  type IRawDiscovery,
} from "./normalize";
import { ScanThrottle } from "./scan-throttle";

/** Thrown when a scan is requested while one is running or the cooldown is active. */
export class ScanThrottledError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`discovery is rate-limited; retry in ${retryAfterMs}ms`);
    this.name = "ScanThrottledError";
  }
}

/**
 * A single discovery mechanism (WS-Discovery or mDNS). It must bound its own duration to roughly
 * timeoutMs and resolve with whatever it found; rejecting is tolerated (the scan continues).
 */
export type DiscoveryProbe = (timeoutMs: number) => Promise<IRawDiscovery[]>;

export interface IDiscoveryServiceOptions {
  probes: DiscoveryProbe[];
  throttle?: ScanThrottle;
  /** Per-scan duration hint passed to each probe. */
  timeoutMs?: number;
  /** Cooldown between scans. */
  cooldownMs?: number;
  /** Hard cap on returned candidates (multicast amplification backstop). */
  maxResults?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_COOLDOWN_MS = 10000;
const DEFAULT_MAX_RESULTS = 64;

// Dedupe by host: one physical camera is one host, but it is often found by more than one
// mechanism (mDNS advertises its RTSP port, WS-Discovery its ONVIF device port) — collapse those.
function dedupeKey(c: ICameraCandidate): string {
  return c.host.toLowerCase();
}

/** Rate-limited orchestrator that runs every probe, normalizes hits, and dedupes the results. */
export class DiscoveryService {
  private readonly probes: DiscoveryProbe[];
  private readonly throttle: ScanThrottle;
  private readonly timeoutMs: number;
  private readonly maxResults: number;

  constructor(options: IDiscoveryServiceOptions) {
    this.probes = options.probes;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    this.throttle =
      options.throttle ??
      new ScanThrottle(options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
  }

  /** Runs one bounded, rate-limited discovery scan. Throws ScanThrottledError when rate-limited. */
  async scan(): Promise<ICameraCandidate[]> {
    if (!this.throttle.canScan()) {
      throw new ScanThrottledError(this.throttle.retryAfterMs());
    }
    this.throttle.begin();
    try {
      const settled = await Promise.all(
        this.probes.map((probe) =>
          probe(this.timeoutMs).catch(() => [] as IRawDiscovery[]),
        ),
      );
      const seen = new Map<string, ICameraCandidate>();
      for (const raw of settled.flat()) {
        const candidate = normalizeDiscovery(raw);
        if (!candidate) {
          continue;
        }
        const key = dedupeKey(candidate);
        const existing = seen.get(key);
        // Prefer the richer hit (one carrying an ONVIF device URL).
        if (!existing || (!existing.onvifUrl && candidate.onvifUrl)) {
          seen.set(key, candidate);
        }
      }
      return Array.from(seen.values()).slice(0, this.maxResults);
    } finally {
      this.throttle.end();
    }
  }
}
