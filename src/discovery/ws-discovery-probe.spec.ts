import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWsDiscoveryProbe, adaptOnvifDevice, type OnvifProbe } from './ws-discovery-probe';
import type { IRawDiscovery } from './normalize';

// The factory wraps an injectable onvif `probe(opts, cb)` and turns it into a
// DiscoveryProbe: (timeoutMs) => Promise<IRawDiscovery[]> that ALWAYS resolves. It runs the probe with
// resolve:false, so the callback yields RAW ProbeMatch objects (no auto-connecting Cam). These tests
// exercise that lifecycle with minimal, faithful fakes of the raw probe-match shape.

/** A raw onvif ProbeMatch as returned with resolve:false (XAddrs is a space-separated URI string). */
const rawMatch = (xaddrs: string) =>
  ({ probeMatches: { probeMatch: { XAddrs: xaddrs } } }) as never;

/** Coerce a fake devices array through the probe callback's declared type. */
function asDevices(value: unknown): never {
  return value as never;
}

describe('createWsDiscoveryProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses the raw XAddr into xaddr + hostname + port', async () => {
    const device = rawMatch('http://192.168.1.60:8080/onvif/device_service');
    const probe: OnvifProbe = (_opts, cb) => cb(null, [device]);

    const result = await createWsDiscoveryProbe(probe)(2000);

    expect(result).toEqual<IRawDiscovery[]>([
      {
        xaddr: 'http://192.168.1.60:8080/onvif/device_service',
        hostname: '192.168.1.60',
        port: 8080,
      },
    ]);
    expect(result).toEqual([adaptOnvifDevice(device)]);
  });

  it('omits the port when the XAddr uses the protocol default (e.g. http :80)', () => {
    expect(adaptOnvifDevice(rawMatch('http://192.168.1.60/onvif')).port).toBeUndefined();
  });

  it('takes the FIRST of multiple space-separated XAddrs', () => {
    const device = rawMatch('http://10.0.0.5/a http://10.0.0.6/b');
    expect(adaptOnvifDevice(device).xaddr).toBe('http://10.0.0.5/a');
  });

  it('passes resolve:false to the probe so the library never auto-connects to the device', async () => {
    const probe = vi.fn<OnvifProbe>((_opts, cb) => cb(null, []));

    await createWsDiscoveryProbe(probe)(2500);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][0]).toEqual({ timeout: 2500, resolve: false });
  });

  it('resolves to [] when the probe reports an error, even if devices are present', async () => {
    const probe: OnvifProbe = (_opts, cb) =>
      cb(new Error('multicast failed'), [rawMatch('http://c')]);
    await expect(createWsDiscoveryProbe(probe)(1000)).resolves.toEqual([]);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'not-an-array'],
    ['a non-array object', { length: 1, 0: {} }],
  ])('resolves to [] when the callback yields %s instead of an array', async (_label, value) => {
    const probe: OnvifProbe = (_opts, cb) => cb(null, asDevices(value));
    await expect(createWsDiscoveryProbe(probe)(1000)).resolves.toEqual([]);
  });

  it('maps a malformed probe-match to all-undefined rather than throwing', () => {
    expect(adaptOnvifDevice({})).toEqual({
      xaddr: undefined,
      hostname: undefined,
      port: undefined,
    });
    expect(adaptOnvifDevice({ probeMatches: { probeMatch: { XAddrs: 42 } } })).toEqual({
      xaddr: undefined,
      hostname: undefined,
      port: undefined,
    });
  });

  it('resolves to [] when the probe throws synchronously (catch path)', async () => {
    const probe: OnvifProbe = () => {
      throw new Error('boom');
    };
    await expect(createWsDiscoveryProbe(probe)(1000)).resolves.toEqual([]);
  });

  it('falls back to [] via the safety backstop when the probe never calls back', async () => {
    const probe: OnvifProbe = () => {};
    const timeoutMs = 3000;
    const promise = createWsDiscoveryProbe(probe)(timeoutMs);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(timeoutMs);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual([]);
  });

  it('keeps the callback result when the safety timeout fires afterward (resolves once)', async () => {
    const device = rawMatch('http://cam:8000/onvif');
    const probe: OnvifProbe = (_opts, cb) => cb(null, [device]);
    const timeoutMs = 1000;
    const promise = createWsDiscoveryProbe(probe)(timeoutMs);

    const expected: IRawDiscovery[] = [
      { xaddr: 'http://cam:8000/onvif', hostname: 'cam', port: 8000 },
    ];
    await expect(promise).resolves.toEqual(expected);
    await vi.advanceTimersByTimeAsync(timeoutMs + 1000);
    await expect(promise).resolves.toEqual(expected);
  });

  it('ignores a second callback invocation (settled guard maps exactly once)', async () => {
    let reads = 0;
    const device = {
      get probeMatches() {
        reads++;
        return { probeMatch: { XAddrs: 'http://cam:8000/onvif' } };
      },
    } as never;
    const probe: OnvifProbe = (_opts, cb) => {
      cb(null, [device]);
      cb(null, [device]); // a duplicate-firing probe must not re-map past the settled guard
    };

    const result = await createWsDiscoveryProbe(probe)(1000);

    expect(result).toEqual([{ xaddr: 'http://cam:8000/onvif', hostname: 'cam', port: 8000 }]);
    expect(reads).toBe(1);
  });

  it('returns a probe function when constructed with the default onvif probe', () => {
    expect(typeof createWsDiscoveryProbe()).toBe('function');
  });
});
