/**
 * Fetches a finalized event clip from a user-run Frigate's HTTP API. The base URL's host is
 * re-checked through the SSRF guard before the request (DNS-rebind defence), only http(s) is allowed,
 * the event id is URL-encoded so it can't escape the /api/events/<id>/clip.mp4 path, and the response
 * is size-capped (Content-Length pre-check + post-read guard) so a huge/hostile body can't OOM the
 * Signal K host. The fetch + SSRF check are injected so this is unit-testable.
 */

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024; // 200 MiB
const DEFAULT_TIMEOUT_MS = 15_000;

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
  });
  if (!res.ok) {
    throw new Error(`frigate clip fetch failed (${res.status})`);
  }
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) {
    throw new Error('frigate clip too large');
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > max) {
    throw new Error('frigate clip too large');
  }
  return new Uint8Array(buf);
}
