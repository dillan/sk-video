import { describe, it, expect } from 'vitest';
import { IncidentController, type IIncidentControllerDeps } from './incident-controller';
import type { IIncidentStore } from './incident-store';
import type { IIncidentBundle } from './incident-validation';
import type { ISegment } from '../recording/recording-segments';
import type { ISelfState, ISelfReading } from '../signalk/sk-bridge';

const utc = (p: { y: number; mo: number; d: number; h: number; mi: number; s: number }): number =>
  Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
const T0 = utc({ y: 2026, mo: 6, d: 27, h: 14, mi: 30, s: 0 });

const reading = <T>(value: T | null): ISelfReading<T> => ({ value });
const SELF: ISelfState = {
  position: reading({ latitude: 1, longitude: 2 }),
  headingTrue: reading(0.5),
  speedOverGround: reading(3),
  courseOverGroundTrue: reading(0.5),
  depth: reading(null),
  wind: { speedApparent: reading(null), angleApparent: reading(null) },
};

const seg = (cameraId: string, name: string): ISegment => ({
  cameraId,
  path: `/rec/${name}`,
  startedAt: T0,
  bytes: 1000,
});
// Each [start, start+60s]; 142930 covers [T0-30s, T0+30s].
const SEGMENTS = [seg('bow', 'bow_20260627_142930.mp4'), seg('stern', 'stern_20260627_142930.mp4')];

function makeStore() {
  const staged: { id: string; assetId: string; bytes: number[] }[] = [];
  const published = new Map<string, IIncidentBundle>();
  const abandoned: string[] = [];
  const store: IIncidentStore = {
    stageAsset: (id, assetId, bytes) => staged.push({ id, assetId, bytes: Array.from(bytes) }),
    publish: (id, m) => published.set(id, m),
    abandon: (id) => abandoned.push(id),
    sweepStaging: () => 0,
    list: () => [...published.values()],
    get: (id) => published.get(id) ?? null,
    summaries: () => [],
    assetPath: (id, a) => `/x/${id}/${a}`,
    delete: (id) => published.delete(id),
    patch: () => null,
    usage: () => ({ totalBytes: 0, count: 0 }),
  };
  return { store, staged, published, abandoned };
}

function setup(over: Partial<IIncidentControllerDeps> = {}) {
  let finalizeCb: (() => void) | null = null;
  let intervalCb: (() => void) | null = null;
  let intervalCreated = false;
  const cleared = { timeout: 0, interval: 0 };
  const calls = { raised: [] as { message: string; data?: object }[], cleared: 0 };
  const fakes = makeStore();
  let n = 0;
  const deps: IIncidentControllerDeps = {
    store: fakes.store,
    captureSnapshot: async (cameraId) => ({
      bytes: new Uint8Array([cameraId.length]),
      contentType: 'image/jpeg',
      telemetry: {
        position: null,
        headingTrue: null,
        speedOverGround: null,
        courseOverGroundTrue: null,
        depth: null,
        windSpeedApparent: null,
        windAngleApparent: null,
        oldestReadingAgeMs: null,
        positionAvailable: false,
      },
    }),
    produceClip: async () => ({ ok: true, bytes: new Uint8Array([7, 7, 7]) }),
    listSegments: () => SEGMENTS,
    getSelfState: () => SELF,
    relevantCameras: () => ['bow', 'stern'],
    raiseNotification: (message, data) => calls.raised.push({ message, data }),
    clearNotification: () => (calls.cleared += 1),
    segmentSeconds: 60,
    defaultPreMs: 30_000,
    defaultPostMs: 30_000,
    sampleIntervalMs: 1000,
    finalizeGraceMs: 500,
    makeEpoch: utc,
    idGen: () => `id-${(n += 1)}`,
    now: () => T0,
    setTimeoutImpl: (fn) => {
      finalizeCb = fn;
      return 1 as never;
    },
    clearTimeoutImpl: () => (cleared.timeout += 1),
    setIntervalImpl: (fn) => {
      intervalCb = fn;
      intervalCreated = true;
      return 2 as never;
    },
    clearIntervalImpl: () => (cleared.interval += 1),
    ...over,
  };
  const controller = new IncidentController(deps);
  return {
    controller,
    ...fakes,
    calls,
    cleared,
    fireFinalize: () => finalizeCb?.(),
    tick: () => intervalCb?.(),
    hasInterval: () => intervalCreated,
  };
}

const flush = async (until: () => boolean): Promise<void> => {
  for (let i = 0; i < 100; i += 1) {
    if (until()) return;
    await Promise.resolve();
  }
};

describe('IncidentController.mark', () => {
  it('returns capturing synchronously, raises the incident notification, and is listed active', () => {
    const h = setup();
    const r = h.controller.mark({ source: 'manual' });
    expect(r.status).toBe('capturing');
    expect(h.calls.raised).toHaveLength(1);
    expect(h.calls.raised[0].message).toMatch(/best-effort/i);
    expect(h.controller.activeAssemblies().map((a) => a.id)).toEqual([r.id]);
  });
});

describe('IncidentController.mark — retrospective (triggerAt)', () => {
  it('anchors the assembly at a past triggerAt instead of now', () => {
    const h = setup();
    const past = T0 - 60_000;
    const { id } = h.controller.mark({ source: 'manual', triggerAt: past });
    expect(h.controller.activeAssemblies()).toEqual([{ id, createdAt: past }]);
  });

  it('caps a future triggerAt at now (no future-anchored window)', () => {
    const h = setup();
    const { id } = h.controller.mark({ source: 'manual', triggerAt: T0 + 999_999 });
    expect(h.controller.activeAssemblies()).toEqual([{ id, createdAt: T0 }]);
  });

  it('skips the live snapshot and forward sampling for a past mark, but still cuts the clip', async () => {
    const h = setup({ relevantCameras: () => ['bow'] });
    // Anchor inside the window the test segments (started 14:29:30) actually cover.
    const past = T0 - 15_000;
    const { id } = h.controller.mark({ source: 'manual', triggerAt: past, postMs: 0 });
    expect(h.hasInterval()).toBe(false); // no forward telemetry sampling
    h.fireFinalize();
    await flush(() => h.published.has(id));
    const bundle = h.published.get(id)!;
    expect(bundle.trigger.firedAt).toBe(past);
    expect(bundle.assets.filter((a) => a.kind === 'snapshot')).toHaveLength(0); // no "now" frame
    expect(bundle.assets.filter((a) => a.kind === 'clip')).toHaveLength(1); // clip still cut
  });
});

describe('IncidentController.finalize', () => {
  it('publishes a complete bundle with a clip + snapshot per camera and a telemetry track, then clears the notification', async () => {
    const h = setup();
    const { id } = h.controller.mark({ source: 'manual' });
    h.fireFinalize();
    await flush(() => h.published.has(id));

    const bundle = h.published.get(id)!;
    expect(bundle.status).toBe('complete');
    expect(bundle.evidence).toBe('best-effort');
    expect(
      bundle.assets
        .filter((a) => a.kind === 'clip')
        .map((a) => a.cameraId)
        .sort(),
    ).toEqual(['bow', 'stern']);
    expect(bundle.assets.filter((a) => a.kind === 'snapshot')).toHaveLength(2);
    expect(bundle.assets.filter((a) => a.kind === 'telemetry')).toHaveLength(1);
    expect(bundle.failures).toHaveLength(0);
    expect(bundle.assets.every((a) => a.sha256.length === 64)).toBe(true);
    expect(h.calls.cleared).toBe(1);
    expect(h.controller.activeAssemblies()).toHaveLength(0);
  });

  it('records a failure and marks partial when a camera has no DVR coverage', async () => {
    const h = setup({ relevantCameras: () => ['bow', 'ghost'] });
    const { id } = h.controller.mark({ source: 'manual' });
    h.fireFinalize();
    await flush(() => h.published.has(id));

    const bundle = h.published.get(id)!;
    expect(bundle.status).toBe('partial');
    expect(bundle.failures).toContainEqual({
      kind: 'clip',
      cameraId: 'ghost',
      reason: 'no DVR segments overlapped the window',
    });
  });

  it('records a snapshot failure without crashing finalize', async () => {
    const h = setup({
      relevantCameras: () => ['bow'],
      captureSnapshot: async () => {
        throw new Error('frame fetch failed (502)');
      },
    });
    const { id } = h.controller.mark({ source: 'manual' });
    h.fireFinalize();
    await flush(() => h.published.has(id));

    const bundle = h.published.get(id)!;
    expect(bundle.failures.some((f) => f.kind === 'snapshot' && f.reason.includes('502'))).toBe(
      true,
    );
    // a clip + telemetry still made it
    expect(bundle.assets.some((a) => a.kind === 'clip')).toBe(true);
  });

  it('records a clip-production failure as partial', async () => {
    const h = setup({ relevantCameras: () => ['bow'], produceClip: async () => ({ ok: false }) });
    const { id } = h.controller.mark({ source: 'manual' });
    h.fireFinalize();
    await flush(() => h.published.has(id));
    const bundle = h.published.get(id)!;
    expect(bundle.status).toBe('partial');
    expect(bundle.failures.some((f) => f.kind === 'clip')).toBe(true);
  });

  it('does not start a telemetry interval when postMs<=0 ("clip last 30s") but still publishes', async () => {
    const h = setup();
    const { id } = h.controller.mark({ source: 'manual', preMs: 30_000, postMs: 0 });
    expect(h.hasInterval()).toBe(false);
    h.fireFinalize();
    await flush(() => h.published.has(id));
    expect(h.published.get(id)!.window).toEqual({ preMs: 30_000, postMs: 0 });
  });
});

describe('IncidentController finalize robustness', () => {
  it('swallows a publish failure: logs, abandons staging, and still clears the notification', async () => {
    const logs: string[] = [];
    const abandoned: string[] = [];
    const throwingStore = {
      ...makeStore().store,
      publish: () => {
        throw new Error('disk full');
      },
      abandon: (id: string) => abandoned.push(id),
    };
    const h = setup({
      relevantCameras: () => ['bow'],
      store: throwingStore,
      log: (m) => logs.push(m),
    });
    const { id } = h.controller.mark({ source: 'manual' });
    h.fireFinalize();
    await flush(() => abandoned.length > 0);
    expect(abandoned).toEqual([id]);
    expect(logs.some((l) => l.includes('finalize failed'))).toBe(true);
    expect(h.calls.cleared).toBe(1); // notification cleared even on failure
  });

  it('calls ensureRecording for each camera at trigger when provided', () => {
    const started: string[] = [];
    const h = setup({
      relevantCameras: () => ['bow', 'stern'],
      ensureRecording: (id) => started.push(id),
    });
    h.controller.mark({ source: 'manual' });
    expect(started).toEqual(['bow', 'stern']);
  });

  it('clears the incident notification on cancelAll so it does not leak across a reload', () => {
    const h = setup({ relevantCameras: () => ['bow'] });
    h.controller.mark({ source: 'manual' }); // raises the 'incident' alert
    const clearedBefore = h.calls.cleared;
    h.controller.cancelAll();
    expect(h.calls.cleared).toBe(clearedBefore + 1);
  });

  it('a finalize that races a teardown abandons instead of publishing', async () => {
    const h = setup({ relevantCameras: () => ['bow'] });
    const { id } = h.controller.mark({ source: 'manual' });
    h.fireFinalize(); // enters finalize, awaits the snapshot promises
    h.controller.cancelAll(); // disposed = true while finalize is suspended
    await flush(() => h.abandoned.includes(id));
    expect(h.published.has(id)).toBe(false);
    expect(h.abandoned).toContain(id);
  });

  it('survives a throwing clearNotification without an unhandled rejection', async () => {
    const h = setup({
      relevantCameras: () => ['bow'],
      clearNotification: () => {
        throw new Error('notifications API down');
      },
    });
    const { id } = h.controller.mark({ source: 'manual' });
    h.fireFinalize();
    await flush(() => h.published.has(id));
    expect(h.published.has(id)).toBe(true); // published before the finally; the throw is swallowed
  });

  it('bounds and strips untrusted auto-trigger fields (path/reason/state)', async () => {
    const longPath = 'notifications.' + 'a'.repeat(400);
    const note = 'fire' + String.fromCharCode(7) + 'x'.repeat(3000);
    const h = setup({
      relevantCameras: () => ['bow'],
      makeEpoch: utc,
    });
    const { id } = h.controller.mark({ source: 'signalk', path: longPath, state: 'alarm', note });
    h.fireFinalize();
    await flush(() => h.published.has(id));
    const t = h.published.get(id)!.trigger;
    expect(t.path!.length).toBeLessThanOrEqual(256);
    expect(t.reason!.length).toBeLessThanOrEqual(2000);
    expect(t.reason!.includes(String.fromCharCode(7))).toBe(false);
    expect(t.state).toBe('alarm');
  });

  it('a silent capture raises and clears no incident notification (the caller owns it)', async () => {
    const h = setup({ relevantCameras: () => ['bow'] });
    const { id } = h.controller.mark({ source: 'signalk', silent: true });
    expect(h.calls.raised).toHaveLength(0); // no own notification raised
    h.fireFinalize();
    await flush(() => h.published.has(id));
    expect(h.calls.cleared).toBe(0); // and none cleared
    expect(h.published.get(id)).toBeTruthy(); // the bundle is still captured + published
  });

  it('names a PNG snapshot asset with a .png extension', async () => {
    const h = setup({
      relevantCameras: () => ['bow'],
      captureSnapshot: async () => ({
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        telemetry: {
          position: null,
          headingTrue: null,
          speedOverGround: null,
          courseOverGroundTrue: null,
          depth: null,
          windSpeedApparent: null,
          windAngleApparent: null,
          oldestReadingAgeMs: null,
          positionAvailable: false,
        },
      }),
    });
    const { id } = h.controller.mark({ source: 'manual' });
    h.fireFinalize();
    await flush(() => h.published.has(id));
    const snap = h.published.get(id)!.assets.find((a) => a.kind === 'snapshot')!;
    expect(snap.name.endsWith('.png')).toBe(true);
  });
});

describe('IncidentController.cancelAll', () => {
  it('clears timers and prevents a late finalize from publishing', async () => {
    const h = setup();
    h.controller.mark({ source: 'manual' });
    h.controller.cancelAll();
    expect(h.cleared.timeout).toBe(1);
    expect(h.controller.activeAssemblies()).toHaveLength(0);
    h.fireFinalize(); // a stray timer firing after stop()
    await flush(() => h.published.size > 0);
    expect(h.published.size).toBe(0);
  });
});
