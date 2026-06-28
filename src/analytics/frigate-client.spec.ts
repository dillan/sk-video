import { describe, it, expect } from 'vitest';
import { FrigateClient, type IFrigateClientDeps } from './frigate-client';
import type { IFrigateMatchConfig } from './frigate-events';

const CONFIG: IFrigateMatchConfig = { labels: ['person'], minScore: 0.7, zones: [] };

const event = (type: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type,
    after: {
      id: 'evt-1',
      camera: 'front_door',
      label: 'person',
      score: 0.9,
      false_positive: false,
      has_clip: false,
      entered_zones: [],
      ...over,
    },
  });

function setup(over: Partial<IFrigateClientDeps> = {}) {
  const raised: { key: string; message: string; data: Record<string, unknown> }[] = [];
  const cleared: string[] = [];
  const fetched: string[] = [];
  let clock = 1000;
  const deps: IFrigateClientDeps = {
    config: CONFIG,
    raiseNotification: (key, message, data) => raised.push({ key, message, data }),
    clearNotification: (key) => cleared.push(key),
    fetchClip: async (id) => {
      fetched.push(id);
      return new Uint8Array([1, 2, 3]);
    },
    storeClip: () => 'asset-1',
    now: () => clock,
    ...over,
  };
  const client = new FrigateClient(deps);
  return { client, raised, cleared, fetched, setClock: (t: number) => (clock = t) };
}

const flush = async (until: () => boolean): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (until()) return;
    await Promise.resolve();
  }
};

describe('FrigateClient', () => {
  it('raises one notification on a qualifying detection and dedupes repeats of the same event', () => {
    const { client, raised } = setup();
    client.handleMessage(event('new'));
    client.handleMessage(event('update')); // same id, still moving
    expect(raised).toHaveLength(1);
    expect(raised[0].key).toBe('frigate.evt-1');
    expect(raised[0].message).toMatch(/person detected on front_door \(90%\)/i);
    expect(client.activeEvents()).toEqual(['evt-1']);
  });

  it('ignores a non-qualifying event (wrong label / low score / false positive)', () => {
    const { client, raised } = setup();
    client.handleMessage(event('new', { label: 'dog' }));
    client.handleMessage(event('new', { id: 'e2', score: 0.2 }));
    client.handleMessage(event('new', { id: 'e3', false_positive: true }));
    expect(raised).toHaveLength(0);
  });

  it('fetches + caches the clip on end and updates the notification with the clip id', async () => {
    const { client, raised, fetched } = setup();
    client.handleMessage(event('new'));
    client.handleMessage(event('end', { has_clip: true }));
    await flush(() => raised.length >= 2);
    expect(fetched).toEqual(['evt-1']);
    const last = raised[raised.length - 1];
    expect(last.message).toMatch(/clip available/);
    expect(last.data.clip).toBe('asset-1');
  });

  it('fetches the clip only once even if end arrives twice', async () => {
    const { client, fetched } = setup();
    client.handleMessage(event('new'));
    client.handleMessage(event('end', { has_clip: true }));
    client.handleMessage(event('end', { has_clip: true }));
    await flush(() => fetched.length >= 1);
    expect(fetched).toEqual(['evt-1']);
  });

  it('does not crash or update when the clip fetch fails', async () => {
    const { client, raised } = setup({
      fetchClip: async () => {
        throw new Error('frigate api 502');
      },
    });
    client.handleMessage(event('new'));
    client.handleMessage(event('end', { has_clip: true }));
    await flush(() => false); // let the rejection settle
    expect(raised).toHaveLength(1); // only the initial detection; no clip update
  });

  it('does not attach a clip when storeClip rejects it (bad type / quota)', async () => {
    const { client, raised } = setup({ storeClip: () => null });
    client.handleMessage(event('new'));
    client.handleMessage(event('end', { has_clip: true }));
    await flush(() => false);
    expect(raised.some((r) => 'clip' in r.data)).toBe(false);
  });

  it('prunes event ids older than the retention window and clears their alert', () => {
    const h = setup({ retentionMs: 1000 });
    h.client.handleMessage(event('new')); // seen at t=1000
    expect(h.client.activeEvents()).toEqual(['evt-1']);
    h.setClock(5000); // > retention later
    h.client.handleMessage(event('new', { id: 'evt-2' }));
    expect(h.client.activeEvents()).toEqual(['evt-2']); // evt-1 pruned
    expect(h.cleared).toEqual(['frigate.evt-1']); // and its alert auto-cleared
  });

  it('reset() clears tracking and every outstanding alert', () => {
    const { client, cleared } = setup();
    client.handleMessage(event('new'));
    client.reset();
    expect(client.activeEvents()).toEqual([]);
    expect(cleared).toEqual(['frigate.evt-1']);
  });

  it('swallows a malformed payload without throwing', () => {
    const { client, raised } = setup();
    expect(() => client.handleMessage('not json')).not.toThrow();
    expect(raised).toHaveLength(0);
  });

  it('swallows a throwing notification sink (it runs off the MQTT callback)', () => {
    const logs: string[] = [];
    const { client } = setup({
      raiseNotification: () => {
        throw new Error('bridge exploded');
      },
      log: (m) => logs.push(m),
    });
    expect(() => client.handleMessage(event('new'))).not.toThrow();
    expect(logs.some((l) => l.includes('bridge exploded'))).toBe(true);
  });
});
