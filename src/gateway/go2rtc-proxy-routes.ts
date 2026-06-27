import type { IRouter, Request, Response } from 'express';
import { go2rtcApiUrl, go2rtcHlsUrl } from './go2rtc-proxy';
import { fetchStreamHealth } from './stream-health';

export interface IProxyContext {
  /** Current go2rtc API port. */
  apiPort: () => number;
  /** Whether a camera id is known — unknown ids are rejected so no client-supplied src is proxied. */
  hasCamera: (id: string) => boolean;
  fetchImpl?: typeof fetch;
}

/** Reads the raw request body (e.g. an SDP offer the server did not parse). */
function readRawBody(req: Request): Promise<string> {
  if (typeof req.body === 'string' && req.body.length > 0) {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
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

  // WHEP: POST an SDP offer, return go2rtc's SDP answer.
  router.post('/cameras/:id/whep', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ctx.hasCamera(id)) {
      res.status(404).json({ error: 'unknown camera' });
      return;
    }
    try {
      const url = go2rtcApiUrl(ctx.apiPort(), 'webrtc', id);
      const offer = await readRawBody(req);
      const upstream = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer,
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
      const upstream = await doFetch(url);
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
      try {
        const url = go2rtcApiUrl(ctx.apiPort(), transport, id);
        const upstream = await doFetch(url);
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
  }
}
