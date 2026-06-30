import { describe, it, expect, vi } from 'vitest';
import { fanOutPush, type ISendFn } from './push-sender';
import type { IPushSubscription } from './push-store';

const sub = (endpoint: string): IPushSubscription => ({
  endpoint,
  keys: { p256dh: 'k', auth: 'a' },
  createdAt: 0,
});

const NOTE = { title: 'Man overboard', body: 'Person overboard', tag: 'mob', url: '#/safety' };

describe('fanOutPush', () => {
  it('sends the JSON payload to every subscription and counts successes', async () => {
    const send: ISendFn = vi.fn().mockResolvedValue({ statusCode: 201 });
    const gone: string[] = [];
    const res = await fanOutPush([sub('https://p/a'), sub('https://p/b')], NOTE, {
      send,
      onGone: (e) => gone.push(e),
    });
    expect(res).toEqual({ sent: 2, pruned: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    // the payload is the serialized notification the service worker will render
    expect(JSON.parse((send as ReturnType<typeof vi.fn>).mock.calls[0][1])).toEqual(NOTE);
  });

  it('prunes a subscription the push service reports as gone (404/410)', async () => {
    const send: ISendFn = vi.fn((s: IPushSubscription) =>
      s.endpoint.endsWith('dead')
        ? Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 }))
        : Promise.resolve({ statusCode: 201 }),
    );
    const gone: string[] = [];
    const res = await fanOutPush([sub('https://p/live'), sub('https://p/dead')], NOTE, {
      send,
      onGone: (e) => gone.push(e),
    });
    expect(res).toEqual({ sent: 1, pruned: 1 });
    expect(gone).toEqual(['https://p/dead']);
  });

  it('does not prune on a transient error (e.g. 500), only logs', async () => {
    const send: ISendFn = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    const gone: string[] = [];
    const log = vi.fn();
    const res = await fanOutPush([sub('https://p/a')], NOTE, {
      send,
      onGone: (e) => gone.push(e),
      log,
    });
    expect(res).toEqual({ sent: 0, pruned: 0 });
    expect(gone).toEqual([]); // a 500 is transient — keep the subscription
    expect(log).toHaveBeenCalled();
  });
});
