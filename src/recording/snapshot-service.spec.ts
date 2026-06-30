import { describe, it, expect } from 'vitest';
import { SnapshotService, SnapshotRejectedError, type ISnapshotMetadata } from './snapshot-service';
import { SignalKBridge, type ISignalKApp } from '../signalk/sk-bridge';

/** A minimal valid JPEG (SOI + APP0/JFIF + EOI) — enough for magic-byte sniffing. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

function bridgeWith(selfPaths: Record<string, unknown>, now = 10_000): SignalKBridge {
  const app: ISignalKApp = { getSelfPath: (p) => selfPaths[p] };
  return new SignalKBridge(app, 'sk-video', { now: () => now });
}

function fakeStore() {
  const saved: { bytes: Uint8Array; meta: ISnapshotMetadata }[] = [];
  return {
    saved,
    save: (bytes: Uint8Array, meta: ISnapshotMetadata) => saved.push({ bytes, meta }),
  };
}

describe('SnapshotService', () => {
  it('captures a frame and stamps it with live telemetry read through the bridge', async () => {
    const store = fakeStore();
    const bridge = bridgeWith({
      'navigation.position': {
        value: { latitude: 47.6, longitude: -122.3 },
        timestamp: '1970-01-01T00:00:09.000Z',
      },
      'navigation.headingTrue': { value: 1.2, timestamp: '1970-01-01T00:00:08.000Z' },
    });
    const svc = new SnapshotService({
      capture: async () => JPEG,
      selfSource: bridge,
      store,
      idGen: () => 'snap-1',
      now: () => 1000,
    });

    const meta = await svc.capture('bow');

    expect(meta).toMatchObject({
      id: 'snap-1',
      cameraId: 'bow',
      createdAt: 1000,
      contentType: 'image/jpeg',
      size: JPEG.length,
    });
    expect(meta.telemetry).toMatchObject({
      position: { latitude: 47.6, longitude: -122.3 },
      headingTrue: 1.2,
      positionAvailable: true,
      oldestReadingAgeMs: 2000, // heading is the oldest reading (10000 - 8000)
    });
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({ bytes: JPEG, meta });
  });

  it('marks position unavailable and never fabricates a fix when the boat has no position', async () => {
    const store = fakeStore();
    const svc = new SnapshotService({
      capture: async () => JPEG,
      selfSource: bridgeWith({}),
      store,
      idGen: () => 'snap-2',
      now: () => 0,
    });

    const { telemetry } = await svc.capture('bow');
    expect(telemetry.position).toBeNull();
    expect(telemetry.positionAvailable).toBe(false);
    expect(telemetry.oldestReadingAgeMs).toBeNull();
  });

  it('defaults the id and timestamp when not injected', async () => {
    const store = fakeStore();
    const svc = new SnapshotService({
      capture: async () => JPEG,
      selfSource: bridgeWith({}),
      store,
    });
    const meta = await svc.capture('bow');
    expect(meta.id).toMatch(/[0-9a-f-]{36}/);
    expect(typeof meta.createdAt).toBe('number');
  });

  it('rejects a captured frame that is not an image and stores nothing', async () => {
    const store = fakeStore();
    const svc = new SnapshotService({
      capture: async () => Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]), // "<html>"
      selfSource: bridgeWith({}),
      store,
    });
    await expect(svc.capture('bow')).rejects.toBeInstanceOf(SnapshotRejectedError);
    expect(store.saved).toEqual([]);
  });

  it('captureBytes returns stamped bytes WITHOUT writing to the snapshot store', async () => {
    const store = fakeStore();
    const svc = new SnapshotService({
      capture: async () => JPEG,
      selfSource: bridgeWith({ 'navigation.position': { value: { latitude: 1, longitude: 2 } } }),
      store,
    });
    const out = await svc.captureBytes('bow');
    expect(out.bytes).toBe(JPEG);
    expect(out.contentType).toBe('image/jpeg');
    expect(out.telemetry.positionAvailable).toBe(true);
    expect(store.saved).toEqual([]); // the incident bundler owns its own store
  });
});
