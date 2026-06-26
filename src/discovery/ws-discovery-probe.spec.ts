import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DiscoveredDevice } from 'onvif';
import { createWsDiscoveryProbe, adaptOnvifDevice, type OnvifProbe } from './ws-discovery-probe';
import type { IRawDiscovery } from './normalize';

// The factory wraps an injectable onvif `probe(opts, cb)` and turns it into a
// DiscoveryProbe: (timeoutMs) => Promise<IRawDiscovery[]> that ALWAYS resolves.
// These tests exercise that lifecycle with minimal, faithful fakes of the probe.

/** Coerce an arbitrary devices argument through the probe callback's declared type. */
function asDevices(value: unknown): DiscoveredDevice[] {
  return value as unknown as DiscoveredDevice[];
}

describe('createWsDiscoveryProbe', () => {
  // Fake timers keep the timeoutMs+1000 safety backstop deterministic and stop the
  // unref'd timer scheduled by the cb-driven tests from leaking into other tests.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with adaptOnvifDevice-mapped hits when the callback yields devices', async () => {
    const device: DiscoveredDevice = {
      hostname: '192.168.1.60',
      port: 80,
      xaddrs: [{ href: 'http://192.168.1.60/onvif/device_service' }],
    };
    const probe: OnvifProbe = (_opts, cb) => cb(null, [device]);

    const result = await createWsDiscoveryProbe(probe)(2000);

    expect(result).toEqual<IRawDiscovery[]>([
      {
        xaddr: 'http://192.168.1.60/onvif/device_service',
        hostname: '192.168.1.60',
        port: 80,
      },
    ]);
    // The factory's output must match what the pure adapter would produce.
    expect(result).toEqual([adaptOnvifDevice(device)]);
  });

  it('passes the per-scan timeout and resolve:true through to the underlying probe', async () => {
    const probe = vi.fn<OnvifProbe>((_opts, cb) => cb(null, []));

    await createWsDiscoveryProbe(probe)(2500);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][0]).toEqual({ timeout: 2500, resolve: true });
  });

  it('resolves to [] when the probe reports an error, even if devices are present', async () => {
    const probe: OnvifProbe = (_opts, cb) =>
      cb(new Error('multicast failed'), [{ hostname: 'cam', port: 80 }]);

    await expect(createWsDiscoveryProbe(probe)(1000)).resolves.toEqual([]);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'not-an-array'],
    ['a non-array object', { length: 1, 0: { hostname: 'cam' } }],
  ])('resolves to [] when the callback yields %s instead of an array', async (_label, value) => {
    const probe: OnvifProbe = (_opts, cb) => cb(null, asDevices(value));

    await expect(createWsDiscoveryProbe(probe)(1000)).resolves.toEqual([]);
  });

  it('resolves to [] when the probe throws synchronously (catch path)', async () => {
    const probe: OnvifProbe = () => {
      throw new Error('boom');
    };

    await expect(createWsDiscoveryProbe(probe)(1000)).resolves.toEqual([]);
  });

  it('falls back to [] via the safety backstop when the probe never calls back', async () => {
    // A probe that never invokes its callback (e.g. a hung socket).
    const probe: OnvifProbe = () => {};
    const timeoutMs = 3000;

    const promise = createWsDiscoveryProbe(probe)(timeoutMs);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });

    // The backstop is timeoutMs + 1000, so it must NOT fire at exactly timeoutMs.
    await vi.advanceTimersByTimeAsync(timeoutMs);
    expect(settled).toBe(false);

    // Crossing timeoutMs + 1000 fires the backstop and resolves to [].
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual([]);
  });

  it('keeps the callback result when the safety timeout fires afterward (resolves once)', async () => {
    const device: DiscoveredDevice = { hostname: 'cam', port: 8000 };
    const probe: OnvifProbe = (_opts, cb) => cb(null, [device]);
    const timeoutMs = 1000;

    const promise = createWsDiscoveryProbe(probe)(timeoutMs);

    const expected: IRawDiscovery[] = [{ xaddr: undefined, hostname: 'cam', port: 8000 }];
    await expect(promise).resolves.toEqual(expected);

    // The unref'd backstop is still scheduled; firing it must not overwrite the result with [].
    await vi.advanceTimersByTimeAsync(timeoutMs + 1000);
    await expect(promise).resolves.toEqual(expected);
  });

  it('ignores a second callback invocation (settled guard maps exactly once)', async () => {
    // Count how many times the result is built: adaptOnvifDevice reads `hostname` once per map.
    let hostnameReads = 0;
    const device = {
      get hostname(): string {
        hostnameReads++;
        return 'cam';
      },
      port: 8000,
    } as DiscoveredDevice;

    // A buggy/duplicate-firing probe: a second finish() would re-map `device` without the guard.
    const probe: OnvifProbe = (_opts, cb) => {
      cb(null, [device]);
      cb(null, [device]);
    };

    const result = await createWsDiscoveryProbe(probe)(1000);

    expect(result).toEqual([{ xaddr: undefined, hostname: 'cam', port: 8000 }]);
    expect(hostnameReads).toBe(1);
  });

  it('returns a probe function when constructed with the default onvif probe', () => {
    // Don't invoke it (that would hit the real network) — just prove the factory wires a default.
    expect(typeof createWsDiscoveryProbe()).toBe('function');
  });
});
