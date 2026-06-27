import { describe, it, expect, vi } from 'vitest';
import {
  SignalKBridge,
  type ISignalKApp,
  type IDeltaMessage,
  type IActionResult,
} from './sk-bridge';

interface Harness {
  app: ISignalKApp;
  deltas: { id: string; msg: IDeltaMessage }[];
  raised: { state: string; message: string; path?: string }[];
  updated: { id: string; o: { state?: string; message?: string } }[];
  cleared: string[];
  puts: {
    context: string;
    path: string;
    cb: Parameters<NonNullable<ISignalKApp['registerPutHandler']>>[2];
    source?: string;
  }[];
}

function makeApp(
  over: Partial<ISignalKApp> = {},
  selfPaths: Record<string, unknown> = {},
): Harness {
  const h: Harness = { app: {}, deltas: [], raised: [], updated: [], cleared: [], puts: [] };
  h.app = {
    handleMessage: (id, msg) => h.deltas.push({ id, msg }),
    getSelfPath: (path) => selfPaths[path],
    notifications: {
      raise: (o) => {
        h.raised.push(o);
        return `note-${h.raised.length}`;
      },
      update: (id, o) => h.updated.push({ id, o }),
      clear: (id) => h.cleared.push(id),
    },
    registerPutHandler: (context, path, cb, source) => h.puts.push({ context, path, cb, source }),
    debug: () => {},
    ...over,
  };
  return h;
}

describe('SignalKBridge — deltas', () => {
  it('emits a single value as a well-formed delta tagged with the plugin id', () => {
    const h = makeApp();
    const ok = new SignalKBridge(h.app, 'sk-video').emit({
      path: 'cameras.bow.stream.state',
      value: 'live',
    });
    expect(ok).toBe(true);
    expect(h.deltas).toEqual([
      {
        id: 'sk-video',
        msg: { updates: [{ values: [{ path: 'cameras.bow.stream.state', value: 'live' }] }] },
      },
    ]);
  });

  it('emits multiple values in a single delta update', () => {
    const h = makeApp();
    new SignalKBridge(h.app, 'sk-video').emit([
      { path: 'cameras.bow.stream.state', value: 'live' },
      { path: 'cameras.bow.ptz.pan', value: 0.5 },
    ]);
    expect(h.deltas[0].msg.updates[0].values).toHaveLength(2);
  });

  it('reports canEmit and degrades when handleMessage is unavailable', () => {
    const h = makeApp({ handleMessage: undefined });
    const bridge = new SignalKBridge(h.app, 'sk-video');
    expect(bridge.canEmit).toBe(false);
    expect(bridge.emit({ path: 'x', value: 1 })).toBe(false);
  });

  it('reports canEmit true when supported', () => {
    expect(new SignalKBridge(makeApp().app, 'sk-video').canEmit).toBe(true);
  });
});

describe('SignalKBridge — self state', () => {
  it('unwraps a { value, timestamp } reading and computes age against the injected clock', () => {
    const h = makeApp(
      {},
      { 'navigation.headingTrue': { value: 1.5, timestamp: '1970-01-01T00:00:05.000Z' } },
    );
    const bridge = new SignalKBridge(h.app, 'sk-video', { now: () => 10_000 });
    const heading = bridge.getSelfState().headingTrue;
    expect(heading.value).toBe(1.5);
    expect(heading.timestamp).toBe('1970-01-01T00:00:05.000Z');
    expect(heading.ageMs).toBe(5_000);
  });

  it('accepts a raw (unwrapped) position object', () => {
    const h = makeApp({}, { 'navigation.position': { latitude: 1.2, longitude: 3.4 } });
    const pos = new SignalKBridge(h.app, 'sk-video').getSelfState().position;
    expect(pos.value).toEqual({ latitude: 1.2, longitude: 3.4 });
    expect(pos.ageMs).toBeUndefined();
  });

  it('returns a null reading for absent paths and when getSelfPath is unavailable', () => {
    expect(new SignalKBridge(makeApp().app, 'sk-video').getSelfState().depth.value).toBeNull();
    const noReader = makeApp({ getSelfPath: undefined });
    expect(new SignalKBridge(noReader.app, 'sk-video').getSelfState().position.value).toBeNull();
  });

  it('swallows a throwing getSelfPath and returns a null reading', () => {
    const h = makeApp({
      getSelfPath: () => {
        throw new Error('data model not ready');
      },
    });
    expect(() => new SignalKBridge(h.app, 'sk-video').getSelfState()).not.toThrow();
    expect(new SignalKBridge(h.app, 'sk-video').getSelfState().speedOverGround.value).toBeNull();
  });
});

describe('SignalKBridge — notifications', () => {
  it('raises via the notifications API and tracks the id, updating on a repeat raise', () => {
    const h = makeApp();
    const bridge = new SignalKBridge(h.app, 'sk-video');
    bridge.raiseNotification('mob', { state: 'emergency', message: 'Person overboard' });
    bridge.raiseNotification('mob', { state: 'alarm', message: 'Person overboard (updating)' });
    expect(h.raised).toHaveLength(1);
    expect(h.raised[0]).toMatchObject({ state: 'emergency', path: 'sk-video.mob' });
    expect(h.updated).toEqual([
      {
        id: 'note-1',
        o: { state: 'alarm', message: 'Person overboard (updating)', data: undefined },
      },
    ]);
  });

  it('clears via the notifications API using the tracked id', () => {
    const h = makeApp();
    const bridge = new SignalKBridge(h.app, 'sk-video');
    bridge.raiseNotification('cam.bow.offline', { state: 'alert', message: 'Bow camera offline' });
    expect(bridge.clearNotification('cam.bow.offline')).toBe(true);
    expect(h.cleared).toEqual(['note-1']);
  });

  it('falls back to a notifications.* delta when the notifications API is absent', () => {
    const h = makeApp({ notifications: undefined });
    const ok = new SignalKBridge(h.app, 'sk-video').raiseNotification('anchor.drag', {
      state: 'alarm',
      message: 'Anchor dragging',
    });
    expect(ok).toBe(true);
    const v = h.deltas[0].msg.updates[0].values[0];
    expect(v.path).toBe('notifications.sk-video.anchor.drag');
    expect(v.value).toMatchObject({ state: 'alarm', message: 'Anchor dragging' });
  });

  it('falls back to a normal-state delta to clear when the notifications API is absent', () => {
    const h = makeApp({ notifications: undefined });
    const bridge = new SignalKBridge(h.app, 'sk-video');
    expect(bridge.clearNotification('anchor.drag')).toBe(true);
    expect(h.deltas[0].msg.updates[0].values[0].value).toMatchObject({ state: 'normal' });
  });
});

describe('SignalKBridge — actions', () => {
  it('registers a PUT handler on vessels.self sourced by the plugin id', () => {
    const h = makeApp();
    const ok = new SignalKBridge(h.app, 'sk-video').registerAction('cameras.mob.activate', () => ({
      state: 'COMPLETED',
      statusCode: 200,
    }));
    expect(ok).toBe(true);
    expect(h.puts[0]).toMatchObject({
      context: 'vessels.self',
      path: 'cameras.mob.activate',
      source: 'sk-video',
    });
  });

  it('runs a synchronous handler and returns its result', () => {
    const h = makeApp();
    const seen: unknown[] = [];
    new SignalKBridge(h.app, 'sk-video').registerAction('cameras.mob.activate', (value) => {
      seen.push(value);
      return { state: 'COMPLETED', statusCode: 200 };
    });
    const result = h.puts[0].cb('vessels.self', 'cameras.mob.activate', true, () => {});
    expect(result).toEqual({ state: 'COMPLETED', statusCode: 200 });
    expect(seen).toEqual([true]);
  });

  it('maps a throwing handler to a FAILED result', () => {
    const h = makeApp();
    new SignalKBridge(h.app, 'sk-video').registerAction('x', () => {
      throw new Error('boom');
    });
    const result = h.puts[0].cb('vessels.self', 'x', 1, () => {}) as IActionResult;
    expect(result.state).toBe('FAILED');
    expect(result.message).toMatch(/boom/);
  });

  it('runs an async handler as PENDING then resolves via the callback', async () => {
    const h = makeApp();
    new SignalKBridge(h.app, 'sk-video').registerAction('x', async () => ({
      state: 'COMPLETED',
      statusCode: 200,
    }));
    const cb = vi.fn();
    const immediate = h.puts[0].cb('vessels.self', 'x', 1, cb) as IActionResult;
    expect(immediate.state).toBe('PENDING');
    await vi.waitFor(() =>
      expect(cb).toHaveBeenCalledWith({ state: 'COMPLETED', statusCode: 200 }),
    );
  });

  it('degrades when registerPutHandler is unavailable', () => {
    const h = makeApp({ registerPutHandler: undefined });
    expect(
      new SignalKBridge(h.app, 'sk-video').registerAction('x', () => ({ state: 'COMPLETED' })),
    ).toBe(false);
  });
});
