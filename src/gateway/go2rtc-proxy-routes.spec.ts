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
    query: {},
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
  const hasSubstream = vi.fn(over.hasSubstream ?? (() => true));
  const hasBackchannel = vi.fn(over.hasBackchannel ?? (() => true));
  const fetchImpl = (over.fetchImpl ?? vi.fn()) as ReturnType<typeof vi.fn>;
  const { router, handlers } = fakeRouter();
  registerProxyRoutes(router, { apiPort, hasCamera, hasSubstream, hasBackchannel, fetchImpl });
  return { handlers, apiPort, hasCamera, hasSubstream, hasBackchannel, fetchImpl };
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

    it('routes ?variant=sub to the camera substream go2rtc stream', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(upstreamRes({ status: 201, text: 'answer' }));
      const { handlers } = setup({ fetchImpl, hasSubstream: () => true });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/whep')!(
        fakeReq({
          params: { id: 'foredeck' } as never,
          query: { variant: 'sub' } as never,
          body: 'offer',
        }),
        res,
      );
      expect(fetchImpl).toHaveBeenCalledWith(
        'http://127.0.0.1:1984/api/webrtc?src=foredeck_sub',
        expect.anything(),
      );
    });

    it('404s ?variant=sub when the camera has no substream, and never fetches', async () => {
      const fetchImpl = vi.fn();
      const { handlers } = setup({ fetchImpl, hasSubstream: () => false });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/whep')!(
        fakeReq({
          params: { id: 'foredeck' } as never,
          query: { variant: 'sub' } as never,
          body: 'offer',
        }),
        res,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'no substream for this camera' });
      expect(fetchImpl).not.toHaveBeenCalled();
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

  describe('POST /cameras/:id/talk (A4 two-way audio)', () => {
    it('forwards the SDP offer to go2rtc webrtc and returns its answer when a backchannel exists', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(upstreamRes({ status: 201, text: 'v=0\r\nanswer' }));
      const { handlers } = setup({ fetchImpl, hasBackchannel: () => true });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/talk')!(
        fakeReq({ params: { id: 'foredeck' } as never, body: 'v=0\r\noffer' }),
        res,
      );
      // The browser's offer must actually be forwarded (not just method/url), with the SDP content type.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:1984/api/webrtc?src=foredeck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: 'v=0\r\noffer',
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['Content-Type']).toBe('application/sdp');
      expect(res.sent).toBe('v=0\r\nanswer'); // go2rtc's SDP answer is relayed back verbatim
    });

    it('502s when the gateway is unreachable', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const { handlers } = setup({ fetchImpl, hasBackchannel: () => true });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/talk')!(
        fakeReq({ params: { id: 'foredeck' } as never, body: 'v=0' }),
        res,
      );
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'gateway unavailable' });
    });

    it('404s a camera with no backchannel, and never fetches', async () => {
      const fetchImpl = vi.fn();
      const { handlers } = setup({ fetchImpl, hasBackchannel: () => false });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/talk')!(
        fakeReq({ params: { id: 'foredeck' } as never, body: 'v=0' }),
        res,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'camera has no two-way audio backchannel' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('404s an unknown camera before the backchannel check', async () => {
      const { handlers } = setup({ hasCamera: () => false, hasBackchannel: () => true });
      const res = makeRes();
      await handlers.get('POST /cameras/:id/talk')!(
        fakeReq({ params: { id: 'ghost' } as never }),
        res,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'unknown camera' });
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

  describe('GET /cameras/:id/health', () => {
    const streams = {
      producers: [
        {
          url: 'rtsp://admin:secret@192.168.1.50:554/h264',
          medias: [{ kind: 'video', codecs: [{ name: 'H264' }] }],
        },
      ],
      consumers: [],
    };

    it('returns 404 for an unknown camera and never fetches', async () => {
      const fetchImpl = vi.fn();
      const { handlers } = setup({ hasCamera: () => false, fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/health')!(
        fakeReq({ params: { id: 'ghost' } as never }),
        res,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'unknown camera' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns the parsed health from go2rtc /api/streams with credentials redacted', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ json: () => Promise.resolve(streams) });
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/health')!(
        fakeReq({ params: { id: 'foredeck' } as never }),
        res,
      );
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:1984/api/streams?src=foredeck');
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ online: true, producers: 1, codecs: ['H264'] });
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it('returns 502 when go2rtc is unreachable', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/health')!(
        fakeReq({ params: { id: 'foredeck' } as never }),
        res,
      );
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'gateway unavailable' });
    });
  });

  describe('GET /cameras/:id/transport (A5)', () => {
    it('recommends a codec-aware transport walk from the stream health', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            producers: [{ medias: [{ codecs: [{ name: 'H265' }] }] }],
            consumers: [],
          }),
      });
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/transport')!(
        fakeReq({ params: { id: 'foredeck' } as never }),
        res,
      );
      expect(res.statusCode).toBe(200);
      expect((res.body as { recommended: string[] }).recommended).toEqual([
        'hls',
        'mjpeg',
        'webrtc',
      ]);
    });

    it('recommends WebRTC first for an ordinary H.264 stream', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            producers: [{ medias: [{ codecs: [{ name: 'H264' }] }] }],
            consumers: [{}],
          }),
      });
      const { handlers } = setup({ fetchImpl });
      const res = makeRes();
      await handlers.get('GET /cameras/:id/transport')!(
        fakeReq({ params: { id: 'foredeck' } as never }),
        res,
      );
      expect(res.statusCode).toBe(200);
      const body = res.body as { recommended: string[]; online: boolean };
      expect(body.recommended).toEqual(['webrtc', 'hls', 'mjpeg']);
      expect(body.online).toBe(true);
    });

    it('404s an unknown camera and 502s an unreachable gateway', async () => {
      const r404 = makeRes();
      await setup({ hasCamera: () => false }).handlers.get('GET /cameras/:id/transport')!(
        fakeReq({ params: { id: 'ghost' } as never }),
        r404,
      );
      expect(r404.statusCode).toBe(404);
      const r502 = makeRes();
      await setup({ fetchImpl: vi.fn().mockRejectedValue(new Error('down')) }).handlers.get(
        'GET /cameras/:id/transport',
      )!(fakeReq({ params: { id: 'foredeck' } as never }), r502);
      expect(r502.statusCode).toBe(502);
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

    it('sets Cache-Control: no-store on frame.jpeg (A5 MJPEG still-loop) but not on the playlist', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          upstreamRes({ status: 200, contentType: 'image/jpeg', bytes: [0xff, 0xd8] }),
        );
      const frameRes = makeRes();
      await setup({ fetchImpl }).handlers.get('GET /cameras/:id/frame.jpeg')!(
        fakeReq({ params: { id: 'foredeck' } as never }),
        frameRes,
      );
      expect(frameRes.headers['Cache-Control']).toBe('no-store');

      const hlsRes = makeRes();
      await setup({
        fetchImpl: vi
          .fn()
          .mockResolvedValue(
            upstreamRes({ status: 200, contentType: 'application/vnd.apple.mpegurl', bytes: [1] }),
          ),
      }).handlers.get('GET /cameras/:id/stream.m3u8')!(
        fakeReq({ params: { id: 'foredeck' } as never }),
        hlsRes,
      );
      expect(hlsRes.headers['Cache-Control']).toBeUndefined();
    });
  });
});
