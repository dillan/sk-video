/**
 * Fetches a finalized event clip from a user-run Frigate's HTTP API. Hardened against a hostile or
 * compromised Frigate: the event id must be a strict slug (so it can't collapse the
 * /api/events/<id>/clip.mp4 path); the base host is re-checked through the SSRF guard; only http(s)
 * is allowed; redirects are REFUSED (`redirect: 'error'`) so a 3xx to loopback/metadata can't slip
 * past the host check; and the body is read with a STREAMING size cap so a chunked over-large body
 * can't be buffered into an OOM. The fetch + SSRF check are injected so this is unit-testable.
 */

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024; // 200 MiB
const DEFAULT_TIMEOUT_MS = 15_000;
// A Frigate event id is a strict slug (e.g. "1607123955.475377-mwz0e6"); reject "." / ".." / slashes.
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface IFrigateClipFetchDeps {
  /** Re-validate the resolved host through the SSRF guard; throws when the host is not allowed. */
  assertHost: (host: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

export async function fetchFrigateClip(
  apiUrl: string,
  eventId: string,
  deps: IFrigateClipFetchDeps,
): Promise<Uint8Array> {
  if (!EVENT_ID_RE.test(eventId)) {
    throw new Error('invalid frigate event id');
  }
  const base = new URL(apiUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('frigate api url must be http or https');
  }
  await deps.assertHost(base.hostname);

  const max = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = new URL(`/api/events/${encodeURIComponent(eventId)}/clip.mp4`, base);
  const res = await doFetch(url.toString(), {
    signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    // A real clip endpoint returns the clip directly; refusing redirects stops a hostile 3xx from
    // sending us (past the SSRF host check) to loopback/link-local/metadata/another LAN host.
    redirect: 'error',
  });
  if (!res.ok) {
    throw new Error(`frigate clip fetch failed (${res.status})`);
  }
  // Content-Length is advisory (a hostile server may omit/lie); it is only a fast reject.
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) {
    throw new Error('frigate clip too large');
  }
  return readCapped(res, max);
}

/** Read the body with a running byte cap so a chunked over-large body is never fully buffered. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    // No stream available (a test/mock or an odd runtime): fall back with a post-read guard.
    const buf = await res.arrayBuffer();
    if (buf.byteLength > max) {
      throw new Error('frigate clip too large');
    }
    return new Uint8Array(buf);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new Error('frigate clip too large');
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
