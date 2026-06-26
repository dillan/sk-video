import { describe, it, expect, beforeEach } from 'vitest';
import { CameraStore, isValidCameraId, type ICameraPersistence } from './camera-store';
import type { ICamera } from './camera-validation';

class FakePersistence implements ICameraPersistence {
  saves = 0;
  constructor(public data: Record<string, ICamera> = {}) {}
  load() {
    return this.data;
  }
  save(cameras: Record<string, ICamera>) {
    this.saves++;
    this.data = cameras;
  }
}

const cam = { name: 'Foredeck', source: { scheme: 'rtsp', host: 'cam.local', port: 554 } };

describe('isValidCameraId', () => {
  it('accepts plain slugs and rejects traversal/odd characters', () => {
    expect(isValidCameraId('foredeck-1')).toBe(true);
    expect(isValidCameraId('../etc')).toBe(false);
    expect(isValidCameraId('a/b')).toBe(false);
    expect(isValidCameraId('')).toBe(false);
    expect(isValidCameraId('a b')).toBe(false);
  });
});

describe('CameraStore', () => {
  let persistence: FakePersistence;
  let store: CameraStore;

  beforeEach(() => {
    persistence = new FakePersistence();
    store = new CameraStore(persistence);
  });

  it('loads existing cameras from persistence', () => {
    const seeded = new FakePersistence({
      a: { name: 'A', enabled: true, source: { scheme: 'rtsp', host: 'h' } },
    });
    const s = new CameraStore(seeded);
    expect(s.get('a')?.name).toBe('A');
  });

  it('validates, stores and persists a camera, and normalises it', () => {
    const saved = store.set('foredeck', cam);
    expect(saved.enabled).toBe(true);
    expect(store.get('foredeck')).toEqual(saved);
    expect(persistence.saves).toBe(1);
  });

  it('throws and does not store an invalid camera (e.g. an exec: scheme)', () => {
    expect(() => store.set('x', { name: 'x', source: { scheme: 'exec', host: 'h' } })).toThrow();
    expect(store.get('x')).toBeNull();
    expect(persistence.saves).toBe(0);
  });

  it('throws on an invalid id', () => {
    expect(() => store.set('../evil', cam)).toThrow();
    expect(persistence.saves).toBe(0);
  });

  it('deletes a camera and persists the change', () => {
    store.set('foredeck', cam);
    expect(store.delete('foredeck')).toBe(true);
    expect(store.get('foredeck')).toBeNull();
    expect(store.delete('foredeck')).toBe(false);
    expect(persistence.saves).toBe(2); // one set, one delete
  });

  it('hands out a copy from list() that cannot mutate the store', () => {
    store.set('foredeck', cam);
    const list = store.list();
    delete list['foredeck'];
    expect(store.get('foredeck')).not.toBeNull();
  });
});
