import { describe, it, expect } from 'vitest';
import { createVideoResourceMethods } from './videos-resource-provider';
import type { AssetStore } from './asset-store';
import type { IVideoAsset } from './asset-store';

function fakeStore(initial: IVideoAsset[] = []): AssetStore & { deleted: string[] } {
  const items = new Map(initial.map((v) => [v.id, v]));
  const deleted: string[] = [];
  return {
    deleted,
    list: () => [...items.values()],
    get: (id: string) => items.get(id) ?? null,
    delete: (id: string) => {
      if (!items.has(id)) return false;
      items.delete(id);
      deleted.push(id);
      return true;
    },
  } as unknown as AssetStore & { deleted: string[] };
}

const V = (id: string): IVideoAsset => ({
  id,
  name: `${id}.mp4`,
  contentType: 'video/mp4',
  size: 100,
  createdAt: 1,
});

describe('createVideoResourceMethods', () => {
  it('lists uploaded videos as an id-keyed map', async () => {
    const methods = createVideoResourceMethods(fakeStore([V('a'), V('b')]));
    const list = await methods.listResources({});
    expect(Object.keys(list).sort()).toEqual(['a', 'b']);
    expect((list.a as IVideoAsset).name).toBe('a.mp4');
  });

  it('gets one video and rejects an unknown id', async () => {
    const methods = createVideoResourceMethods(fakeStore([V('a')]));
    expect(((await methods.getResource('a')) as IVideoAsset).name).toBe('a.mp4');
    await expect(methods.getResource('nope')).rejects.toThrow();
  });

  it('drills into a property with dot notation', async () => {
    const methods = createVideoResourceMethods(fakeStore([V('a')]));
    await expect(methods.getResource('a', 'contentType')).resolves.toEqual({ value: 'video/mp4' });
  });

  it('deletes a video and rejects deleting an unknown one', async () => {
    const store = fakeStore([V('a')]);
    const methods = createVideoResourceMethods(store);
    await expect(methods.deleteResource('a')).resolves.toBeUndefined();
    expect(store.deleted).toEqual(['a']);
    await expect(methods.deleteResource('a')).rejects.toThrow();
  });

  it('refuses writes through the resource API (uploads go through the binary route)', async () => {
    const methods = createVideoResourceMethods(fakeStore());
    await expect(methods.setResource('a', { name: 'x' })).rejects.toThrow(/not.*supported|upload/i);
  });
});
