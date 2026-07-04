import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDeltaValues,
  stripNotificationId,
  notificationKey,
  applyVesselDelta,
  reduceAlerts,
  streamUrl,
  SkStream,
  type ISocketLike,
} from './sk-stream';

describe('parseDeltaValues', () => {
  it('extracts path/value pairs from a delta frame', () => {
    const frame = JSON.stringify({
      updates: [
        { values: [{ path: 'navigation.position', value: { latitude: 1, longitude: 2 } }] },
        { values: [{ path: 'notifications.sk-video.mob', value: { state: 'emergency' } }] },
      ],
    });
    expect(parseDeltaValues(frame)).toHaveLength(2);
  });

  it('tolerates hello frames, junk, and non-JSON without throwing', () => {
    expect(parseDeltaValues(JSON.stringify({ name: 'signalk-server', roles: [] }))).toEqual([]);
    expect(parseDeltaValues('{not json')).toEqual([]);
    expect(parseDeltaValues(42)).toEqual([]);
  });
});

describe('notification path normalization', () => {
  it('strips a trailing server-appended UUID segment', () => {
    expect(
      stripNotificationId('notifications.sk-video.mob.9922c05a-2813-4995-ab72-33f8f2246ff7'),
    ).toBe('notifications.sk-video.mob');
    expect(stripNotificationId('notifications.sk-video.mob')).toBe('notifications.sk-video.mob');
  });

  it('maps plugin paths to keys and rejects foreign subtrees', () => {
    expect(notificationKey('notifications.sk-video.camera.bow.offline')).toBe('camera.bow.offline');
    expect(notificationKey('notifications.sk-video.mob.9922c05a-2813-4995-ab72-33f8f2246ff7')).toBe(
      'mob',
    );
    expect(notificationKey('notifications.anchor.dragging')).toBeNull();
    expect(notificationKey('navigation.position')).toBeNull();
  });

  it('maps camera-path alarms (notifications.cameras.*) to keys the ack route accepts', () => {
    // Camera alarms live on the camera's own path; the key is the path minus `notifications.`,
    // which matches the plugin bridge's notification key for the same alarm.
    expect(notificationKey('notifications.cameras.bow.feedOutage')).toBe('cameras.bow.feedOutage');
    expect(
      notificationKey('notifications.cameras.bow.feedOutage.9922c05a-2813-4995-ab72-33f8f2246ff7'),
    ).toBe('cameras.bow.feedOutage');
    expect(notificationKey('notifications.cameras.stern.detections.person')).toBe(
      'cameras.stern.detections.person',
    );
  });
});

describe('applyVesselDelta', () => {
  const empty = { hasFix: false };

  it('folds position/heading/SOG deltas into the strip state', () => {
    let v = applyVesselDelta(empty, {
      path: 'navigation.position',
      value: { latitude: 48.42, longitude: -123.37 },
    });
    v = applyVesselDelta(v, { path: 'navigation.headingTrue', value: Math.PI });
    v = applyVesselDelta(v, { path: 'navigation.speedOverGround', value: 5.144 });
    expect(v.hasFix).toBe(true);
    expect(v.headingDeg).toBeCloseTo(180);
    expect(v.sogKn).toBeCloseTo(10, 1);
  });

  it('loses the fix honestly when position goes null, and true heading beats magnetic', () => {
    const withFix = applyVesselDelta(empty, {
      path: 'navigation.position',
      value: { latitude: 1, longitude: 2 },
    });
    expect(applyVesselDelta(withFix, { path: 'navigation.position', value: null }).hasFix).toBe(
      false,
    );
    const trueHdg = applyVesselDelta(empty, { path: 'navigation.headingTrue', value: 0 });
    expect(
      applyVesselDelta(trueHdg, { path: 'navigation.headingMagnetic', value: Math.PI }).headingDeg,
    ).toBe(0);
  });

  it('ignores unrelated paths', () => {
    expect(applyVesselDelta(empty, { path: 'environment.depth', value: 3 })).toBe(empty);
  });
});

describe('reduceAlerts', () => {
  it('adds an alarm, marks a shared ack as silenced, and clears on normal', () => {
    let alerts = reduceAlerts({}, 'mob', {
      state: 'emergency',
      message: 'Person overboard',
      method: ['visual', 'sound'],
    });
    expect(alerts.mob).toMatchObject({ state: 'emergency', silenced: false });

    alerts = reduceAlerts(alerts, 'mob', {
      state: 'emergency',
      message: 'Person overboard',
      method: [],
    });
    expect(alerts.mob.silenced).toBe(true);

    alerts = reduceAlerts(alerts, 'mob', { state: 'normal', message: '' });
    expect(alerts.mob).toBeUndefined();
  });

  it('treats status.acknowledged (server notifications API) as silenced too', () => {
    const alerts = reduceAlerts({}, 'mob', {
      state: 'alarm',
      message: 'x',
      method: ['visual'],
      status: { acknowledged: true },
    });
    expect(alerts.mob.silenced).toBe(true);
  });

  it('clears on a null value (notification deleted)', () => {
    const alerts = reduceAlerts(
      { mob: { key: 'mob', state: 'alarm', message: '', silenced: false } },
      'mob',
      null,
    );
    expect(alerts.mob).toBeUndefined();
  });
});

describe('streamUrl', () => {
  it('follows the page scheme and preserves a proxy prefix', () => {
    expect(streamUrl({ protocol: 'https:', host: 'boat.local:3443' }, '')).toBe(
      'wss://boat.local:3443/signalk/v1/stream?subscribe=none',
    );
    expect(streamUrl({ protocol: 'http:', host: 'localhost:3000' }, '/proxy')).toBe(
      'ws://localhost:3000/proxy/signalk/v1/stream?subscribe=none',
    );
  });
});

describe('SkStream', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeSocketFactory() {
    const sockets: ISocketLike[] = [];
    const makeSocket = (): ISocketLike => {
      const s: ISocketLike = {
        send: vi.fn(),
        close: vi.fn(() => s.onclose?.()),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      sockets.push(s);
      return s;
    };
    return { sockets, makeSocket };
  }

  it('subscribes on open, reseeds via onConnect, and delivers parsed deltas', () => {
    const { sockets, makeSocket } = fakeSocketFactory();
    const onDelta = vi.fn();
    const onConnect = vi.fn();
    const states: string[] = [];
    const stream = new SkStream({
      url: 'ws://x/stream',
      onDelta,
      onConnect,
      onState: (s) => states.push(s),
      makeSocket,
    });
    stream.start();
    sockets[0].onopen?.();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse((sockets[0].send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string),
    ).toMatchObject({ context: 'vessels.self' });
    sockets[0].onmessage?.({
      data: JSON.stringify({ updates: [{ values: [{ path: 'navigation.position', value: {} }] }] }),
    });
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting', 'live']);
    stream.stop();
  });

  it('subscribes to camera-path alarms so relocated camera notifications reach the shell', () => {
    const { sockets, makeSocket } = fakeSocketFactory();
    const stream = new SkStream({ url: 'ws://x/stream', onDelta: () => undefined, makeSocket });
    stream.start();
    sockets[0].onopen?.();
    const subscribe = JSON.parse(
      (sockets[0].send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
    ) as { subscribe: { path: string; policy?: string }[] };
    expect(subscribe.subscribe).toContainEqual({
      path: 'notifications.cameras.*',
      policy: 'instant',
    });
    // The plugin-prefixed subtree stays subscribed for vessel-scoped keys (mob, incident, anchor).
    expect(subscribe.subscribe).toContainEqual({
      path: 'notifications.sk-video.*',
      policy: 'instant',
    });
    stream.stop();
  });

  it('reconnects with backoff after a close, and reseeds again on the reopen', () => {
    const { sockets, makeSocket } = fakeSocketFactory();
    const onConnect = vi.fn();
    const states: string[] = [];
    const stream = new SkStream({
      url: 'ws://x/stream',
      onDelta: () => undefined,
      onConnect,
      onState: (s) => states.push(s),
      makeSocket,
      reconnectBaseMs: 100,
      random: () => 0,
    });
    stream.start();
    sockets[0].onopen?.();
    sockets[0].onclose?.(); // link drops
    expect(states).toContain('reconnecting');
    vi.advanceTimersByTime(150);
    expect(sockets).toHaveLength(2);
    sockets[1].onopen?.();
    expect(onConnect).toHaveBeenCalledTimes(2); // MUST reseed REST state after every reconnect
    stream.stop();
  });

  it('recycles a silent socket via the stall timer', () => {
    const { sockets, makeSocket } = fakeSocketFactory();
    const stream = new SkStream({
      url: 'ws://x/stream',
      onDelta: () => undefined,
      makeSocket,
      stallMs: 1000,
      reconnectBaseMs: 100,
      random: () => 0,
    });
    stream.start();
    sockets[0].onopen?.();
    vi.advanceTimersByTime(1100); // nothing arrives → the stall timer closes the socket
    expect(sockets[0].close).toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(sockets.length).toBeGreaterThan(1); // and a reconnect follows
    stream.stop();
  });

  it('never reconnects after stop()', () => {
    const { sockets, makeSocket } = fakeSocketFactory();
    const stream = new SkStream({
      url: 'ws://x/stream',
      onDelta: () => undefined,
      makeSocket,
      reconnectBaseMs: 100,
      random: () => 0,
    });
    stream.start();
    sockets[0].onopen?.();
    stream.stop();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
  });
});
