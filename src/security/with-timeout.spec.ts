import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from './with-timeout';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('resolves with the value when the promise settles first', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects with the original error when the promise rejects first', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow(/boom/);
  });

  it('rejects with a timeout error when the promise hangs past the deadline', async () => {
    vi.useFakeTimers();
    const assertion = expect(
      withTimeout(new Promise<never>(() => {}), 5000, 'dns lookup timed out'),
    ).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});
