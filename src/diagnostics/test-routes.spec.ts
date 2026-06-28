import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerTestRoutes, type ITestContext } from './test-routes';
import type { IFfprobeOutcome } from './probe';

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(_k: string, _v: string) {
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function setup(overrides: Partial<ITestContext> = {}) {
  const ctx: ITestContext = {
    ready: () => true,
    assertHostAllowed: vi.fn().mockResolvedValue(undefined),
    runFfprobe: vi.fn().mockResolvedValue({
      code: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
    } satisfies IFfprobeOutcome),
    tcpProbe: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  let captured!: (req: Request, res: Response) => unknown;
  const router = {
    post: (_p: string, h: (req: Request, res: Response) => unknown) => {
      captured = h;
    },
  } as unknown as IRouter;
  registerTestRoutes(router, ctx);
  const call = async (body: unknown) => {
    const res = makeRes();
    await captured({ body } as Request, res);
    return res;
  };
  return { ctx, call };
}

const RTSP = { source: { scheme: 'rtsp', host: 'cam.local', port: 554, path: '/stream1' } };

describe('registerTestRoutes', () => {
  it('returns 503 before the plugin has started', async () => {
    const { call } = setup({ ready: () => false });
    const res = await call(RTSP);
    expect(res.statusCode).toBe(503);
  });

  it('returns 429 when rate-limited and never probes', async () => {
    const runFfprobe = vi.fn();
    const { call } = setup({
      rateLimit: () => ({ ok: false, retryAfterMs: 5000 }),
      runFfprobe,
    });
    const res = await call(RTSP);
    expect(res.statusCode).toBe(429);
    expect(runFfprobe).not.toHaveBeenCalled();
  });

  it('rejects an unsafe scheme (no exec:/ffmpeg: RCE) with 400 and never probes', async () => {
    const { ctx, call } = setup();
    const res = await call({ source: { scheme: 'exec', host: 'evil' } });
    expect(res.statusCode).toBe(400);
    expect(ctx.runFfprobe).not.toHaveBeenCalled();
    expect(ctx.assertHostAllowed).not.toHaveBeenCalled();
  });

  it('rejects a missing/invalid host with 400', async () => {
    const { call } = setup();
    const res = await call({ source: { scheme: 'rtsp', host: 'bad host!' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when the SSRF guard blocks the address', async () => {
    const { ctx, call } = setup({
      assertHostAllowed: vi.fn().mockRejectedValue(new Error('blocked')),
    });
    const res = await call(RTSP);
    expect(res.statusCode).toBe(403);
    expect(ctx.runFfprobe).not.toHaveBeenCalled();
  });

  it('probes a reachable rtsp camera and reports codec + resolution', async () => {
    const runFfprobe = vi.fn().mockResolvedValue({
      code: 0,
      timedOut: false,
      stdout: JSON.stringify({ streams: [{ codec_name: 'h264', width: 1280, height: 720 }] }),
      stderr: '',
    });
    const { call } = setup({ runFfprobe });
    const res = await call(RTSP);
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean; codec?: string }).ok).toBe(true);
    expect((res.body as { codec?: string }).codec).toBe('h264');
    // ffprobe is given the constructed source URL as the last arg (no shell).
    const args = runFfprobe.mock.calls[0][0] as string[];
    expect(args[args.length - 1]).toBe('rtsp://cam.local:554/stream1');
  });

  it('suggests candidate RTSP paths for a known make/model hint (so the user can verify one before saving)', async () => {
    const { call } = setup();
    const res = await call({ ...RTSP, hint: 'Reolink RLC-810A' });
    expect((res.body as { suggestedPaths?: unknown }).suggestedPaths).toEqual({
      main: '/h264Preview_01_main',
      sub: '/h264Preview_01_sub',
    });
  });

  it('still suggests paths when the probe of the current path fails (that is when alternatives help)', async () => {
    const runFfprobe = vi
      .fn()
      .mockResolvedValue({ code: 1, timedOut: false, stdout: '', stderr: '404' });
    const { call } = setup({ runFfprobe });
    const res = await call({ ...RTSP, hint: 'Hikvision' });
    expect((res.body as { ok: boolean }).ok).toBe(false);
    expect((res.body as { suggestedPaths?: { main: string } }).suggestedPaths?.main).toBe(
      '/Streaming/Channels/101',
    );
  });

  it('omits suggestedPaths for an unknown make/model', async () => {
    const { call } = setup();
    const res = await call({ ...RTSP, hint: 'NoSuchBrand 9000' });
    expect((res.body as { suggestedPaths?: unknown }).suggestedPaths).toBeUndefined();
  });

  it('passes write-only credentials into the probe url', async () => {
    const runFfprobe = vi
      .fn()
      .mockResolvedValue({ code: 0, timedOut: false, stdout: '{"streams":[]}', stderr: '' });
    const { call } = setup({ runFfprobe });
    await call({ ...RTSP, username: 'admin', password: 'p@ss' });
    const args = runFfprobe.mock.calls[0][0] as string[];
    expect(args[args.length - 1]).toBe('rtsp://admin:p%40ss@cam.local:554/stream1');
  });

  it('reports an unreachable camera (non-zero ffprobe exit)', async () => {
    const { call } = setup({
      runFfprobe: vi.fn().mockResolvedValue({ code: 1, timedOut: false, stdout: '', stderr: 'x' }),
    });
    const res = await call(RTSP);
    expect((res.body as { ok: boolean }).ok).toBe(false);
  });

  it('uses a TCP reachability check for an ONVIF camera', async () => {
    const tcpProbe = vi.fn().mockResolvedValue(true);
    const runFfprobe = vi.fn();
    const { call } = setup({ tcpProbe, runFfprobe });
    const res = await call({ source: { scheme: 'onvif', host: 'cam.local', port: 8000 } });
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(tcpProbe).toHaveBeenCalledWith('cam.local', 8000, expect.any(Number));
    expect(runFfprobe).not.toHaveBeenCalled();
  });

  it('reports a friendly message when ffprobe is not installed', async () => {
    const { call } = setup({ runFfprobe: vi.fn().mockRejectedValue(new Error('ENOENT')) });
    const res = await call(RTSP);
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean; message: string }).ok).toBe(false);
    expect((res.body as { message: string }).message).toContain('ffmpeg');
  });
});
