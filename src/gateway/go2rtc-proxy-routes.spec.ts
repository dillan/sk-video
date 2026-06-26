import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerProxyRoutes, type IProxyContext } from './go2rtc-proxy-routes';

/** A router that captures handlers keyed by "METHOD path" so each route can be invoked directly. */
function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => unknown>();
  const add =
    (method: string) =>
    (path: string, ...rest: Array<(req: Request, res: Response) => unknown>) =>
      handlers.set(`${method} ${path}`, rest[rest.length - 1]);
  const router = {
    get: add('GET'),
    post: add('POST'),
  } as unknown as IRouter;
  return { router, handlers };
}

type CapturedRes = Response & {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  sent: unknown;
  ended: boolean;
};

/** A res mock that records status, headers, json payload, and sent body. */
function makeRes(): CapturedRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    sent: undefined as unknown,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    send(b: unknown) {
      this.sent = b;
      this.ended = true;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res as unknown as CapturedRes;
}

function fakeReq(over: Partial<Request> & { body?: unknown } = {}): Request {
  return {
    params: {},
    headers: {},
    url: '',
    setEncoding: () => undefined,
    on: () => undefined,
    ...over,
  } as unknown as Request;
}

/** Builds an upstream fetch response of the shape the handlers consume. */
function upstreamRes(opts: {
  status?: number;
  text?: string;
  contentType?: string | null;
  bytes?: number[];
}) {
  return {
    status: opts.status ?? 200,
    text: () => Promise.resolve(opts.text ?? ''),
    headers: {
      get: (k: string) => (k === 'content-type' ? (opts.contentType ?? null) : null),
    },
    arrayBuffer: () => Promise.resolve(new Uint8Array(opts.bytes ?? []).buffer),
  };
}

const PORT = 1984;

function setup(over: Partial<IProxyContext> = {}) {
  const apiPort = over.apiPort ?? (() => PORT);
  const hasCamera = vi.fn(over.hasCamera ?? (() => true));
  const fetchImpl = (over.fetchImpl ?? vi.fn()) as ReturnType<typeof vi.fn>;
  const { router, handlers } = fakeRouter();
  registerProxyRoutes(router, { apiPort, hasCamera, fetchImpl });
  return { handlers, apiPort, hasCamera, fetchImpl };
}

describe('registerProxyRoutes', () => {
  describe('POST /cameras/:id/whep', () => {
    it('returns 404 for an unknown camera and never fetches', async () => {
      const fetchImpl = vi.fn();
      const { handlers, hasCamera } = setup({ hasCamera: () => false, fetchImpl });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/whep')!(
        fakeReq({ params: { id: 'ghost' } as never, body: 'v=0' }),
        res,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'unknown camera' });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(hasCamera).toHaveBeenCalledWith('ghost');
    });

    it('forwards the SDP offer to go2rtc webrtc and returns the answer', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(upstreamRes({ status: 201, text: 'v=0\r\no=answer' }));
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/whep')!(
        fakeReq({ params: { id: 'foredeck' } as never, body: 'v=0\r\no=offer' }),
        res,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:1984/api/webrtc?src=foredeck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: 'v=0\r\no=offer',
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['Content-Type']).toBe('application/sdp');
      expect(res.sent).toBe('v=0\r\no=answer');
    });

    it('returns 502 when the upstream fetch rejects', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/whep')!(
        fakeReq({ params: { id: 'foredeck' } as never, body: 'v=0' }),
        res,
      );
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'gateway unavailable' });
    });
  });

  describe('GET /cameras/:id/hls/:resource', () => {
    it('returns 404 for an unknown camera and never fetches', async () => {
      const fetchImpl = vi.fn();
      const { handlers } = setup({ hasCamera: () => false, fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/hls/:resource')!(
        fakeReq({
          params: { id: 'ghost', resource: 'segment.ts' } as never,
          url: '/cameras/ghost/hls/segment.ts?n=1',
        }),
        res,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'unknown camera' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('strips a client-supplied src and proxies the remaining query to go2rtc hls', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          upstreamRes({ status: 200, contentType: 'video/mp2t', bytes: [0x47, 0x01, 0x02] }),
        );
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/hls/:resource')!(
        fakeReq({
          params: { id: 'foredeck', resource: 'segment.ts' } as never,
          // The handler must read the raw query off req.url, NOT req.query.
          url: '/cameras/foredeck/hls/segment.ts?src=../evil&id=7&n=3',
        }),
        res,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const calledUrl = fetchImpl.mock.calls[0][0] as string;
      // SECURITY: the client-supplied src must never reach go2rtc.
      expect(calledUrl).not.toContain('src=');
      expect(calledUrl).not.toContain('evil');
      expect(calledUrl.startsWith('http://127.0.0.1:1984/api/hls/segment.ts')).toBe(true);
      expect(calledUrl).toContain('n=3');
      expect(calledUrl).toBe('http://127.0.0.1:1984/api/hls/segment.ts?id=7&n=3');
      // Passthrough of status, content-type, and body.
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('video/mp2t');
      expect(Array.from(res.sent as Buffer)).toEqual([0x47, 0x01, 0x02]);
    });

    it('does not set Content-Type when the upstream omits it', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(upstreamRes({ status: 200, contentType: null, bytes: [1] }));
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/hls/:resource')!(
        fakeReq({
          params: { id: 'foredeck', resource: 'playlist.m3u8' } as never,
          url: '/cameras/foredeck/hls/playlist.m3u8',
        }),
        res,
      );
      expect(res.headers['Content-Type']).toBeUndefined();
      expect(res.statusCode).toBe(200);
    });

    it('returns 404 (not found) on a traversal resource and never fetches', async () => {
      const fetchImpl = vi.fn();
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/hls/:resource')!(
        fakeReq({
          params: { id: 'foredeck', resource: '..' } as never,
          url: '/cameras/foredeck/hls/..',
        }),
        res,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'not found' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns 404 (not found) on a resource containing a slash and never fetches', async () => {
      const fetchImpl = vi.fn();
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/hls/:resource')!(
        fakeReq({
          params: { id: 'foredeck', resource: 'a/b' } as never,
          url: '/cameras/foredeck/hls/a/b',
        }),
        res,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'not found' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns 502 when the upstream fetch rejects after a valid url', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/hls/:resource')!(
        fakeReq({
          params: { id: 'foredeck', resource: 'segment.ts' } as never,
          url: '/cameras/foredeck/hls/segment.ts?n=1',
        }),
        res,
      );
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'gateway unavailable' });
    });
  });

  describe('GET passthrough routes (frame.jpeg / stream.m3u8)', () => {
    const cases: Array<{ name: string; key: string; expectedUrl: string }> = [
      {
        name: 'frame.jpeg',
        key: 'GET /cameras/:id/frame.jpeg',
        expectedUrl: 'http://127.0.0.1:1984/api/frame.jpeg?src=foredeck',
      },
      {
        name: 'stream.m3u8',
        key: 'GET /cameras/:id/stream.m3u8',
        expectedUrl: 'http://127.0.0.1:1984/api/stream.m3u8?src=foredeck',
      },
    ];

    for (const c of cases) {
      it(`${c.name}: returns 404 for an unknown camera and never fetches`, async () => {
        const fetchImpl = vi.fn();
        const { handlers } = setup({ hasCamera: () => false, fetchImpl });
        const res = makeRes();
        await handlers.get(c.key)!(fakeReq({ params: { id: 'ghost' } as never }), res);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: 'unknown camera' });
        expect(fetchImpl).not.toHaveBeenCalled();
      });

      it(`${c.name}: proxies to the loopback go2rtc url and passes through body and content-type`, async () => {
        const fetchImpl = vi
          .fn()
          .mockResolvedValue(
            upstreamRes({ status: 200, contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] }),
          );
        const { handlers } = setup({ fetchImpl });
        const res = makeRes();
        await handlers.get(c.key)!(fakeReq({ params: { id: 'foredeck' } as never }), res);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledWith(c.expectedUrl);
        expect(res.statusCode).toBe(200);
        expect(res.headers['Content-Type']).toBe('image/jpeg');
        expect(Array.from(res.sent as Buffer)).toEqual([0xff, 0xd8, 0xff]);
      });

      it(`${c.name}: returns 502 when the upstream fetch rejects`, async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
        const { handlers } = setup({ fetchImpl });
        const res = makeRes();
        await handlers.get(c.key)!(fakeReq({ params: { id: 'foredeck' } as never }), res);
        expect(res.statusCode).toBe(502);
        expect(res.body).toEqual({ error: 'gateway unavailable' });
      });
    }
  });
});
