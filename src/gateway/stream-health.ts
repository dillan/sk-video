/**
 * Reads go2rtc's /api/streams introspection for one camera and maps it to a minimal, safe health DTO
 * (online / producer + consumer counts / negotiated codecs / redacted source URLs). go2rtc's JSON is
 * NOT a stable contract — it is pinned to GO2RTC_VERSION and parsed defensively, tolerating drift and
 * never throwing on shape. This is a diagnostic hint ("why is this feed black?"), not an SLA monitor:
 * go2rtc connects to a source lazily, so a healthy camera with no current viewer reads as not-online.
 */
import { redactUrl } from '../security/redact';
import { go2rtcStreamsUrl, go2rtcAllStreamsUrl } from './go2rtc-proxy';

export interface IStreamHealth {
  /** A producer (source connection) is currently active in go2rtc. */
  online: boolean;
  producers: number;
  consumers: number;
  /** Negotiated codec names, e.g. ["H264", "PCMA"]. */
  codecs: string[];
  /** Producer source URLs with any credentials redacted. */
  sources: string[];
}

export function parseStreamHealth(raw: unknown, cameraId: string): IStreamHealth {
  const stream = pickStream(raw, cameraId);
  const allProducers = asArray(stream?.producers);
  // go2rtc lists every CONFIGURED source as a producer entry ({url} only); a producer that is
  // actually CONNECTED carries connection detail. Counting configured entries would make a dead
  // camera read "online" forever, so only connected producers count.
  const producers = allProducers.filter(isConnectedProducer);
  const consumers = asArray(stream?.consumers);

  const codecs = new Set<string>();
  for (const conn of producers) {
    collectCodecs(conn, codecs);
  }
  for (const conn of consumers) {
    collectCodecs(conn, codecs);
  }

  const sources: string[] = [];
  for (const producer of allProducers) {
    const url = (producer as { url?: unknown }).url;
    if (typeof url === 'string' && url.length > 0) {
      sources.push(redactUrl(url));
    }
  }

  return {
    online: producers.length > 0,
    producers: producers.length,
    consumers: consumers.length,
    codecs: [...codecs],
    sources,
  };
}

/** A producer entry with any connection evidence (go2rtc adds these only while connected). */
function isConnectedProducer(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const p = entry as { remote_addr?: unknown; id?: unknown; medias?: unknown };
  return (
    p.remote_addr !== undefined ||
    p.id !== undefined ||
    (Array.isArray(p.medias) && p.medias.length > 0)
  );
}

/** A stalled go2rtc must not hang the proxy handler forever — bound every loopback read. */
const LOOPBACK_TIMEOUT_MS = 5000;

export async function fetchStreamHealth(opts: {
  apiPort: number;
  cameraId: string;
  /** `sub` reads the `<id>_sub` go2rtc stream — its own producer, codec, and health. */
  variant?: 'main' | 'sub';
  fetchImpl?: typeof fetch;
}): Promise<IStreamHealth> {
  const doFetch = opts.fetchImpl ?? fetch;
  const variant = opts.variant ?? 'main';
  const upstream = await doFetch(go2rtcStreamsUrl(opts.apiPort, opts.cameraId, variant), {
    signal: AbortSignal.timeout(LOOPBACK_TIMEOUT_MS),
  });
  const data: unknown = await upstream.json();
  return parseStreamHealth(data, variant === 'sub' ? `${opts.cameraId}_sub` : opts.cameraId);
}

/**
 * One bulk read for the whole wall: fetch go2rtc's full /api/streams once and parse each camera out
 * of the keyed response, instead of N loopback round-trips. Ids with no stream entry parse to the
 * honest all-zero health (offline, nothing negotiated).
 */
export async function fetchAllStreamsHealth(opts: {
  apiPort: number;
  cameraIds: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<Record<string, IStreamHealth>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const upstream = await doFetch(go2rtcAllStreamsUrl(opts.apiPort), {
    signal: AbortSignal.timeout(LOOPBACK_TIMEOUT_MS),
  });
  const data: unknown = await upstream.json();
  const out: Record<string, IStreamHealth> = {};
  for (const id of opts.cameraIds) {
    out[id] = parseStreamHealth(data, id);
  }
  return out;
}

/** The /api/streams response may be the stream object directly (src filter) or keyed by name. */
function pickStream(
  raw: unknown,
  cameraId: string,
): { producers?: unknown; consumers?: unknown } | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if ('producers' in obj || 'consumers' in obj) {
    return obj;
  }
  const byId = obj[cameraId];
  return byId && typeof byId === 'object' ? (byId as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Pulls codec names out of a go2rtc connection's medias[].codecs[].name, tolerating any drift. */
function collectCodecs(conn: unknown, out: Set<string>): void {
  if (!conn || typeof conn !== 'object') {
    return;
  }
  for (const media of asArray((conn as { medias?: unknown }).medias)) {
    if (!media || typeof media !== 'object') {
      continue;
    }
    for (const codec of asArray((media as { codecs?: unknown }).codecs)) {
      const name = (codec as { name?: unknown })?.name;
      if (typeof name === 'string' && name.length > 0) {
        out.add(name);
      }
    }
  }
}
