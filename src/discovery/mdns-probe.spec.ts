import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMdnsProbe, CAMERA_SERVICES } from './mdns-probe';

// The `make` factory type, lifted from the probe itself so the test never imports multicast-dns
// types directly. The fake is hidden behind this cast, so its shape is ours to define.
type MakeMdns = Parameters<typeof createMdnsProbe>[0];

interface FakePacket {
  answers?: unknown[];
  additionals?: unknown[];
}
type ResponseHandler = (packet: FakePacket) => void;
type ErrorHandler = (err: Error) => void;

// A faithful stand-in for a multicast-dns instance: it captures the 'response'/'error' handlers the
// probe registers so a test can drive packets/errors, and records query/destroy calls.
function createFakeMdns(opts: { destroyThrows?: boolean } = {}) {
  const handlers: { response?: ResponseHandler; error?: ErrorHandler } = {};

  const query = vi.fn();
  const destroy = vi.fn(() => {
    if (opts.destroyThrows) {
      throw new Error('destroy failed');
    }
  });
  const on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'response') {
      handlers.response = cb as unknown as ResponseHandler;
    } else if (event === 'error') {
      handlers.error = cb as unknown as ErrorHandler;
    }
    return fake;
  });
  const fake = { on, query, destroy };

  const makeSpy = vi.fn(() => fake);
  const make = makeSpy as unknown as MakeMdns;

  const emitResponse = (packet: FakePacket): void => {
    if (!handlers.response) {
      throw new Error('probe never registered a response handler');
    }
    handlers.response(packet);
  };
  const emitError = (err: Error = new Error('socket error')): void => {
    if (!handlers.error) {
      throw new Error('probe never registered an error handler');
    }
    handlers.error(err);
  };

  return { make, makeSpy, on, query, destroy, emitResponse, emitError };
}

// A camera advertised over mDNS: an SRV under _rtsp._tcp plus a matching A record for its target.
const SRV_RTSP = {
  name: 'Front Door._rtsp._tcp.local',
  type: 'SRV',
  data: { target: 'cam-1.local', port: 554 },
};
const A_CAM1 = { name: 'cam-1.local', type: 'A', data: '10.0.0.7' };
const EXPECTED_HIT = { hostname: '10.0.0.7', port: 554, name: 'Front Door' };

describe('createMdnsProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves to [] immediately when make() throws (no socket available)', async () => {
    const makeSpy = vi.fn(() => {
      throw new Error('bind EADDRINUSE');
    });
    const probe = createMdnsProbe(makeSpy as unknown as MakeMdns);

    // Resolves on the microtask queue without any timer needing to fire.
    await expect(probe(1000)).resolves.toEqual([]);
    expect(makeSpy).toHaveBeenCalledTimes(1);
  });

  it('registers handlers for both the response and error events before querying', () => {
    const { make, on, query } = createFakeMdns();
    const probe = createMdnsProbe(make);

    // Kick off a scan; the promise executor runs synchronously and wires up the socket handlers.
    void probe(1000);

    // The probe must subscribe to both events — these are what emitResponse/emitError drive.
    expect(on).toHaveBeenCalledWith('response', expect.any(Function));
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
    // Exactly those two and nothing else, and they are wired before any query goes out so a fast
    // responder can't slip a packet past us.
    expect(on).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(CAMERA_SERVICES.length);
    expect(on.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]);
  });

  it('queries every camera service once, parses a response, and tears down on timeout', async () => {
    const { make, query, destroy, emitResponse } = createFakeMdns();
    const probe = createMdnsProbe(make);

    const pending = probe(2000);

    // The query loop runs synchronously inside the promise executor: one PTR query per service.
    expect(query).toHaveBeenCalledTimes(CAMERA_SERVICES.length);
    expect(CAMERA_SERVICES).toHaveLength(4);
    for (const service of CAMERA_SERVICES) {
      expect(query).toHaveBeenCalledWith({
        questions: [{ name: `${service}.local`, type: 'PTR' }],
      });
    }

    emitResponse({ answers: [SRV_RTSP, A_CAM1] });

    // Not resolved until the scan window elapses.
    expect(destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toEqual([EXPECTED_HIT]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('merges records from packet.additionals as well as packet.answers', async () => {
    const { make, emitResponse } = createFakeMdns();
    const probe = createMdnsProbe(make);

    const pending = probe(1000);
    emitResponse({
      answers: [
        { name: 'Aft._onvif._tcp.local', type: 'SRV', data: { target: 'aft.local', port: 80 } },
      ],
      additionals: [{ name: 'aft.local', type: 'A', data: '10.0.0.9' }],
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual([{ hostname: '10.0.0.9', port: 80, name: 'Aft' }]);
  });

  it('finishes early and resolves to [] when the error handler fires before any records arrive', async () => {
    const { make, destroy, emitError } = createFakeMdns();
    const probe = createMdnsProbe(make);

    const pending = probe(5000);
    emitError(new Error('ENETUNREACH'));

    // Resolves immediately on error — no timer advance needed — proving finish ran early.
    await expect(pending).resolves.toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('resolves with the records buffered before the error when the error fires after a response', async () => {
    const { make, destroy, emitResponse, emitError } = createFakeMdns();
    const probe = createMdnsProbe(make);

    const pending = probe(5000);

    // A response lands first, buffering a real hit...
    emitResponse({ answers: [SRV_RTSP, A_CAM1] });
    // ...then the socket errors out. finish() runs early but parses whatever was already collected.
    emitError(new Error('ENETUNREACH'));

    // Resolves on the error alone (no timer advance), and keeps the hit captured beforehand.
    await expect(pending).resolves.toEqual([EXPECTED_HIT]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('settles exactly once when both the error and the timeout fire (settled guard)', async () => {
    const { make, destroy, emitError } = createFakeMdns();
    const probe = createMdnsProbe(make);

    const pending = probe(1000);
    emitError(); // first finish()
    await vi.advanceTimersByTimeAsync(1000); // timeout would call finish() again

    await expect(pending).resolves.toEqual([]);
    // The settled guard short-circuits the second finish, so teardown happens only once.
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('still resolves (does not reject) when destroy() throws during teardown', async () => {
    const { make, destroy, emitResponse } = createFakeMdns({ destroyThrows: true });
    const probe = createMdnsProbe(make);

    const pending = probe(1000);
    emitResponse({ answers: [SRV_RTSP, A_CAM1] });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual([EXPECTED_HIT]);
    expect(destroy).toHaveBeenCalledTimes(1); // it was attempted, and its throw was swallowed
  });

  it('swallows per-question query() errors and still resolves on timeout', async () => {
    const { make, query, destroy } = createFakeMdns();
    query.mockImplementation(() => {
      throw new Error('send EMSGSIZE');
    });
    const probe = createMdnsProbe(make);

    const pending = probe(1000);
    // Every service was still attempted despite each throwing.
    expect(query).toHaveBeenCalledTimes(CAMERA_SERVICES.length);

    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
