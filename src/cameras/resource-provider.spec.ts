import { describe, it, expect, beforeEach } from 'vitest';
import { createCameraResourceMethods, type ICameraResourceMethods } from './resource-provider';
import { CameraStore, type ICameraPersistence } from './camera-store';
import type { ICamera } from './camera-validation';

class MemoryPersistence implements ICameraPersistence {
  constructor(public data: Record<string, ICamera> = {}) {}
  load() {
    return this.data;
  }
  save(c: Record<string, ICamera>) {
    this.data = c;
  }
}

const cam = { name: 'Foredeck', source: { scheme: 'rtsp', host: 'cam.local' } };

describe('createCameraResourceMethods', () => {
  let store: CameraStore;
  let methods: ICameraResourceMethods;

  beforeEach(() => {
    store = new CameraStore(new MemoryPersistence());
    methods = createCameraResourceMethods(store);
  });

  it('lists cameras as an id-keyed map', async () => {
    await methods.setResource('foredeck', cam);
    const list = await methods.listResources({});
    expect(Object.keys(list)).toEqual(['foredeck']);
    expect((list['foredeck'] as ICamera).name).toBe('Foredeck');
  });

  it('gets a camera by id and rejects an unknown one', async () => {
    await methods.setResource('foredeck', cam);
    expect(((await methods.getResource('foredeck')) as ICamera).name).toBe('Foredeck');
    await expect(methods.getResource('nope')).rejects.toThrow();
  });

  it('validates on setResource (rejecting an exec: scheme)', async () => {
    await expect(
      methods.setResource('x', { name: 'x', source: { scheme: 'exec', host: 'h' } }),
    ).rejects.toThrow();
    expect(store.get('x')).toBeNull();
  });

  it('deletes a camera and rejects deleting an unknown one', async () => {
    await methods.setResource('foredeck', cam);
    await expect(methods.deleteResource('foredeck')).resolves.toBeUndefined();
    expect(store.get('foredeck')).toBeNull();
    await expect(methods.deleteResource('foredeck')).rejects.toThrow();
  });
});
