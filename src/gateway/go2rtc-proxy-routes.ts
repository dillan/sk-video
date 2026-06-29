import type { IRouter, Request, Response } from 'express';
import { go2rtcApiUrl, go2rtcVariantUrl, go2rtcHlsUrl } from './go2rtc-proxy';
import { fetchStreamHealth } from './stream-health';
import { transportHints } from './transport-hints';

export interface IProxyContext {
  /** Current go2rtc API port. */
  apiPort: () => number;
  /** Whether a camera id is known — unknown ids are rejected so no client-supplied src is proxied. */
  hasCamera: (id: string) => boolean;
  /** Whether a camera has a low-res substream variant configured. */
  hasSubstream?: (id: string) => boolean;
  /** Whether a camera has a two-way audio backchannel (an ONVIF audio output / speaker). */
  hasBackchannel?: (id: string) => boolean;
  fetchImpl?: typeof fetch;
}

// An SDP offer is only a few KB; cap the raw read so a same-origin client can't stream an unbounded
// body into memory through /talk or /whep.
const MAX_SDP_BYTES = 64 * 1024;
// A stalled go2rtc must not hang a proxy handler indefinitely — bound every loopback fetch.
const LOOPBACK_TIMEOUT_MS = 10_000;
const loopbackSignal = (): AbortSignal => AbortSignal.timeout(LOOPBACK_TIMEOUT_MS);

/** Reads the raw request body (e.g. an SDP offer the server did not parse), bounded to MAX_SDP_BYTES. */
function readRawBody(req: Request): Promise<string> {
  if (typeof req.body === 'string' && req.body.length > 0) {
    return Promise.resolve(req.body);
  }
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return Promise.resolve(req.body.toString('utf8'));
  }
  // If a middleware already drained the stream, the 'data'/'end' events will never fire — don't hang.
  if (req.readableEnded || req.complete) {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
      if (data.length > MAX_SDP_BYTES) {
        req.destroy();
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}

/**
 * Registers the same-origin transport proxy. The browser only ever talks to these endpoints, keyed by
 * an internal camera id; the plugin forwards to go2rtc on loopback. A client-supplied `src=` is never
 * honoured.
 */
export function registerProxyRoutes(router: IRouter, ctx: IProxyContext): void {
  const doFetch = ctx.fetchImpl ?? fetch;

  // WHEP: POST an SDP offer, return go2rtc's SDP answer. `?variant=sub` selects the low-res substream.
  router.post('/cameras/:id/whep', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ctx.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    const wantSub = req.query.variant === 'sub';
    if (wantSub && !(ctx.hasSubstream?.(id) ?? false)) {
      res.status(404).json({ error: 'no substream for this camera' });
      return;
    }
    try {
      const url = go2rtcVariantUrl(ctx.apiPort(), 'webrtc', id, wantSub ? 'sub' : 'main');
      const offer = await readRawBody(req);
      const upstream = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer,
        signal: loopbackSignal(),
      });
      const answer = await upstream.text();
      res.status(upstream.status).set('Content-Type', 'application/sdp').send(answer);
    } catch {
      res.status(502).json({ error: 'gateway unavailable' });
    }
  });

  // Two-way audio backchannel (A4): same WebRTC negotiation as WHEP, but gated on the camera
  // reporting an audio output (speaker). The browser's SDP offer carries the talk audio track and
  // go2rtc routes it to the camera's NATIVE backchannel — this is not WHIP (which is ingest-only),
  // and it is camera/codec-dependent (PCMU/AAC), best-effort hailing/intercom, not telephony-grade.
  router.post('/cameras/:id/talk', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ctx.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    if (!(ctx.hasBackchannel?.(id) ?? false)) {
      res.status(404).json({ error: 'camera has no two-way audio backchannel' });
      return;
    }
    try {
      const url = go2rtcApiUrl(ctx.apiPort(), 'webrtc', id);
      const offer = await readRawBody(req);
      const upstream = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer,
        signal: loopbackSignal(),
      });
      const answer = await upstream.text();
      res.status(upstream.status).set('Content-Type', 'application/sdp').send(answer);
    } catch {
      res.status(502).json({ error: 'gateway unavailable' });
    }
  });

  // HLS sub-resources (media playlist, segments, init segment) referenced by the master playlist.
  // The master uses relative URLs, so these resolve back through the proxy and need no rewriting.
  router.get('/cameras/:id/hls/:resource', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ctx.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    let url: string;
    try {
      const resource = String(req.params.resource);
      const qIdx = req.url.indexOf('?');
      const rawQuery = qIdx >= 0 ? req.url.slice(qIdx + 1) : '';
      url = go2rtcHlsUrl(ctx.apiPort(), id, resource, rawQuery);
    } catch {
      res.status(404).json({ error: 'not found' });
      return;
    }
    try {
      const upstream = await doFetch(url, { signal: loopbackSignal() });
      const contentType = upstream.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status).send(body);
    } catch {
      res.status(502).json({ error: 'gateway unavailable' });
    }
  });

  // Stream health: a diagnostic DTO derived from go2rtc /api/streams (source URLs redacted).
  router.get('/cameras/:id/health', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ctx.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    try {
      const health = await fetchStreamHealth({
        apiPort: ctx.apiPort(),
        cameraId: id,
        fetchImpl: doFetch,
      });
      res.json(health);
    } catch {
      res.status(502).json({ error: 'gateway unavailable' });
    }
  });

  // Adaptive transport contract (A5): the recommended transport walk for the widget to fall back on.
  router.get('/cameras/:id/transport', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ctx.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    try {
      const health = await fetchStreamHealth({
        apiPort: ctx.apiPort(),
        cameraId: id,
        fetchImpl: doFetch,
      });
      res.json(transportHints(health));
    } catch {
      res.status(502).json({ error: 'gateway unavailable' });
    }
  });

  // Snapshot frame and HLS master playlist: GET passthrough.
  const getRoutes: [string, 'frame' | 'hls'][] = [
    ['/cameras/:id/frame.jpeg', 'frame'],
    ['/cameras/:id/stream.m3u8', 'hls'],
  ];
  for (const [path, transport] of getRoutes) {
    router.get(path, async (req: Request, res: Response) => {
      const id = String(req.params.id);
      if (!ctx.hasCamera(id)) {
        res.status(404).json({ error: 'unknown camera' });
        return;
      }
      // `?variant=sub` serves the low-res H.264 substream — the browser-decodable path when the main
      // stream is H.265. Gated on the camera actually having one, mirroring the WHEP route.
      const wantSub = req.query.variant === 'sub';
      if (wantSub && !(ctx.hasSubstream?.(id) ?? false)) {
        res.status(404).json({ error: 'no substream for this camera' });
        return;
      }
      try {
        const url = wantSub
          ? go2rtcVariantUrl(ctx.apiPort(), transport, id, 'sub')
          : go2rtcApiUrl(ctx.apiPort(), transport, id);
        const upstream = await doFetch(url, { signal: loopbackSignal() });
        const contentType = upstream.headers.get('content-type');
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        if (transport === 'frame') {
          // The MJPEG still-refresh fallback (A5) re-fetches this in a loop; never let a cache serve
          // a stale frame.
          res.setHeader('Cache-Control', 'no-store');
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        res.status(upstream.status).send(body);
      } catch {
        res.status(502).json({ error: 'gateway unavailable' });
      }
    });
  }
}
