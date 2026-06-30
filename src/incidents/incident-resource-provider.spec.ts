import { describe, it, expect } from 'vitest';
import { createIncidentResourceMethods } from './incident-resource-provider';
import type { IIncidentStore } from './incident-store';
import type { IIncidentBundle, IIncidentPatch } from './incident-validation';

function fakeStore(seed: Record<string, IIncidentBundle> = {}) {
  const map = new Map(Object.entries(seed));
  const patched: { id: string; fields: IIncidentPatch }[] = [];
  const deleted: string[] = [];
  const store = {
    get: (id) => map.get(id) ?? null,
    list: () => [...map.values()],
    patch: (id, fields) => {
      patched.push({ id, fields });
      const b = map.get(id);
      if (!b) return null;
      const updated = { ...b, ...fields };
      map.set(id, updated);
      return updated;
    },
    delete: (id) => {
      deleted.push(id);
      return map.delete(id);
    },
  } as unknown as IIncidentStore;
  return { store, patched, deleted };
}

const bundle = (id: string, over: Partial<IIncidentBundle> = {}): IIncidentBundle =>
  ({ id, status: 'complete', assets: [], failures: [], ...over }) as IIncidentBundle;

describe('createIncidentResourceMethods', () => {
  it('lists bundles keyed by id and gets one', async () => {
    const { store } = fakeStore({ a: bundle('a'), b: bundle('b') });
    const m = createIncidentResourceMethods(store);
    expect(Object.keys(await m.listResources({}))).toEqual(['a', 'b']);
    expect((await m.getResource('a')) as IIncidentBundle).toMatchObject({ id: 'a' });
  });

  it('getResource throws not-found', async () => {
    const m = createIncidentResourceMethods(fakeStore().store);
    await expect(m.getResource('missing')).rejects.toThrow(/not found/);
  });

  it('setResource validates the patch and rejects unknown keys / missing bundle', async () => {
    const { store, patched } = fakeStore({ a: bundle('a') });
    const m = createIncidentResourceMethods(store);
    await m.setResource('a', { label: 'grounding', pinned: true });
    expect(patched[0]).toEqual({ id: 'a', fields: { label: 'grounding', pinned: true } });
    await expect(m.setResource('a', { status: 'failed' })).rejects.toThrow(/unexpected/);
    await expect(m.setResource('missing', { label: 'x' })).rejects.toThrow(/not found/);
  });

  it('deleteResource refuses a pinned bundle and 404s a missing one', async () => {
    const { store, deleted } = fakeStore({ a: bundle('a', { pinned: true }), b: bundle('b') });
    const m = createIncidentResourceMethods(store);
    await expect(m.deleteResource('a')).rejects.toThrow(/pinned/);
    await m.deleteResource('b');
    expect(deleted).toEqual(['b']);
    await expect(m.deleteResource('missing')).rejects.toThrow(/not found/);
  });
});
