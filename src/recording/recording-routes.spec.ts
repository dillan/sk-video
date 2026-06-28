import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import type { IRouter, Request, Response } from 'express';
import { registerRecordingRoutes } from './recording-routes';
import { RecordingManager } from './recording-manager';
import type { ISegment } from './recording-segments';

/** A router that captures handlers keyed by "METHOD path". */
function fakeRouter() {
  const handlers = new Map<string, (req: Request, res: Response) => void>();
  const add =
    (method: string) =>
    (path: string, ...rest: Array<(req: Request, res: Response) => void>) =>
      handlers.set(`${method} ${path}`, rest[rest.length - 1]);
  const router = {
    get: add('GET'),
    post: add('POST'),
  } as unknown as IRouter;
  return { router, handlers };
}

class FakeRes extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown;
  chunks: Buffer[] = [];
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  json(payload: unknown): this {
    this.body = payload;
    this.end();
    return this;
  }
  get headersSent(): boolean {
    return false;
  }
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
}

function fakeReq(over: Partial<Request> & { body?: unknown } = {}): Request {
  return { params: {}, headers: {}, on: () => undefined, ...over } as unknown as Request;
}

function makeManager(maxChannels = 2) {
  const spawned: string[][] = [];
  const stopped: string[] = [];
  const manager = new RecordingManager({
    dir: '/rec',
    rtspBase: () => 'rtsp://127.0.0.1:8554',
    spawnRecorder: (args) => {
      spawned.push(args);
      const id = args[args.length - 1];
      return { stop: () => stopped.push(id) };
    },
    maxChannels: () => maxChannels,
    limits: () => ({ maxBytes: Infinity, maxAgeMs: Infinity }),
    listSegments: () => [],
    removeFile: () => undefined,
  });
  return { manager, spawned, stopped };
}

const SEGMENTS: ISegment[] = [
  { cameraId: 'bow', path: '/rec/bow_20260627_143000.mp4', startedAt: 1000, bytes: 8 },
  { cameraId: 'bow', path: '/rec/bow_20260627_143100.mp4', startedAt: 2000, bytes: 4 },
];

function setup(maxChannels = 2, segments: ISegment[] = SEGMENTS) {
  const { router, handlers } = fakeRouter();
  const { manager, spawned, stopped } = makeManager(maxChannels);
  registerRecordingRoutes(router, {
    getManager: () => manager,
    hasCamera: (id) => id === 'bow' || id === 'stern',
    listSegments: () => segments,
    streamFactory: (_path, opts) => {
      const full = Buffer.from('MP4DATA!');
      const slice = opts ? full.subarray(opts.start, opts.end + 1) : full;
      return Readable.from(slice) as never;
    },
  });
  return { handlers, manager, spawned, stopped };
}

describe('registerRecordingRoutes', () => {
  it('caches the segment scan so repeated Range requests do not re-scan the directory each time', () => {
    const { router, handlers } = fakeRouter();
    const { manager } = makeManager(2);
    let scans = 0;
    let clock = 0;
    registerRecordingRoutes(router, {
      getManager: () => manager,
      hasCamera: () => true,
      listSegments: () => {
        scans += 1;
        return SEGMENTS;
      },
      streamFactory: () => Readable.from(Buffer.from('MP4DATA!')) as never,
      segmentCacheTtlMs: 1000,
      now: () => clock,
    });
    handlers.get('GET /recordings')!(fakeReq(), new FakeRes() as unknown as Response);
    handlers.get('GET /recordings')!(fakeReq(), new FakeRes() as unknown as Response);
    expect(scans).toBe(1); // second request within the TTL hits the cache
    clock = 2000; // past the TTL
    handlers.get('GET /recordings')!(fakeReq(), new FakeRes() as unknown as Response);
    expect(scans).toBe(2); // re-scanned after the cache expired
  });

  it('POST /cameras/:id/record starts a recorder and reports recording:true', () => {
    const { handlers, manager, spawned } = setup();
    const res = new FakeRes();
    handlers.get('POST /cameras/:id/record')!(
      fakeReq({ params: { id: 'bow' }, body: { active: true } }),
      res as unknown as Response,
    );
    expect(spawned).toHaveLength(1);
    expect(manager.isRecording('bow')).toBe(true);
    expect(res.body).toEqual({ recording: true });
  });

  it('POST /cameras/:id/record with active:false stops the recorder', () => {
    const { handlers, manager } = setup();
    manager.start('bow');
    const res = new FakeRes();
    handlers.get('POST /cameras/:id/record')!(
      fakeReq({ params: { id: 'bow' }, body: { active: false } }),
      res as unknown as Response,
    );
    expect(manager.isRecording('bow')).toBe(false);
    expect(res.body).toEqual({ recording: false });
  });

  it('returns 409 when the tier offers no recording channels', () => {
    const { handlers } = setup(0);
    const res = new FakeRes();
    handlers.get('POST /cameras/:id/record')!(
      fakeReq({ params: { id: 'bow' }, body: { active: true } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ recording: false });
  });

  it('returns 404 for an unknown camera', () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('POST /cameras/:id/record')!(
      fakeReq({ params: { id: 'ghost' }, body: { active: true } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(404);
  });

  it('GET /recordings lists segments newest-first with the active set', () => {
    const { handlers, manager } = setup();
    manager.start('bow');
    const res = new FakeRes();
    handlers.get('GET /recordings')!(fakeReq(), res as unknown as Response);
    const body = res.body as { recording: string[]; segments: { name: string }[] };
    expect(body.recording).toEqual(['bow']);
    expect(body.segments.map((s) => s.name)).toEqual([
      'bow_20260627_143100.mp4',
      'bow_20260627_143000.mp4',
    ]);
  });

  it('GET /recordings/timeline returns a per-camera scrubbable contract', () => {
    const { handlers, manager } = setup();
    manager.start('bow');
    const res = new FakeRes();
    handlers.get('GET /recordings/timeline')!(fakeReq(), res as unknown as Response);
    const tl = res.body as {
      segmentSeconds: number;
      cameras: {
        camera: string;
        recording: boolean;
        segments: { name: string; durationMs: number }[];
      }[];
    };
    expect(tl.segmentSeconds).toBe(60);
    expect(tl.cameras).toHaveLength(1);
    expect(tl.cameras[0].camera).toBe('bow');
    expect(tl.cameras[0].recording).toBe(true);
    expect(tl.cameras[0].segments.map((s) => s.name)).toEqual([
      'bow_20260627_143000.mp4', // oldest-first for the timeline (vs newest-first for the flat list)
      'bow_20260627_143100.mp4',
    ]);
    // First segment's span is capped to the 1s gap to the next; the active last segment grows from now.
    expect(tl.cameras[0].segments[0].durationMs).toBe(1000);
  });

  it('GET /recordings/timeline returns 503 before the plugin has started', () => {
    const { router, handlers } = fakeRouter();
    registerRecordingRoutes(router, {
      getManager: () => null,
      hasCamera: () => false,
      listSegments: () => [],
    });
    const res = new FakeRes();
    handlers.get('GET /recordings/timeline')!(fakeReq(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
  });

  it('GET /recordings/:name streams a segment with Range support', () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('GET /recordings/:name')!(
      fakeReq({ params: { name: 'bow_20260627_143000.mp4' }, headers: { range: 'bytes=0-3' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-3/8');
    expect(res.headers['Content-Type']).toBe('video/mp4');
  });

  it('rejects a traversal name with 400', () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('GET /recordings/:name')!(
      fakeReq({ params: { name: '../secret' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown segment name', () => {
    const { handlers } = setup();
    const res = new FakeRes();
    handlers.get('GET /recordings/:name')!(
      fakeReq({ params: { name: 'bow_20260101_000000.mp4' } }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(404);
  });

  it('returns 503 before the plugin is started', () => {
    const { router, handlers } = fakeRouter();
    registerRecordingRoutes(router, {
      getManager: () => null,
      hasCamera: () => true,
      listSegments: () => [],
    });
    const res = new FakeRes();
    handlers.get('GET /recordings')!(fakeReq(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
  });
});
