import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseSsdpResponses,
  createSsdpProbe,
  type ISsdpSocket,
  type MakeSsdpSocket,
} from './ssdp-probe';

const resp = (lines: string[]) => [...lines, '', ''].join('\r\n');

const CAM = resp([
  'HTTP/1.1 200 OK',
  'CACHE-CONTROL: max-age=1800',
  'LOCATION: http://192.168.1.50:8080/description.xml',
  'SERVER: Linux/3.10 UPnP/1.0 Hikvision-Webservice/1.0',
  'ST: urn:schemas-upnp-org:device:Basic:1',
  'USN: uuid:abcd::urn:schemas-upnp-org:device:Basic:1',
]);

const ONVIF_NVT = resp([
  'HTTP/1.1 200 OK',
  'LOCATION: http://10.0.0.9/onvif/device',
  'ST: urn:schemas-onvif-org:device:NetworkVideoTransmitter:1',
  'SERVER: ipcam UPnP/1.0',
]);

const ROUTER = resp([
  'HTTP/1.1 200 OK',
  'LOCATION: http://192.168.1.1:1900/igd.xml',
  'SERVER: Linux UPnP/1.0 MiniUPnPd/2.0',
  'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1',
]);

describe('parseSsdpResponses', () => {
  it('keeps a camera-like device and returns its host', () => {
    expect(parseSsdpResponses([CAM])).toEqual([{ hostname: '192.168.1.50' }]);
  });

  it('keeps an ONVIF NetworkVideoTransmitter even without a brand', () => {
    expect(parseSsdpResponses([ONVIF_NVT])).toEqual([{ hostname: '10.0.0.9' }]);
  });

  it('drops non-camera devices (routers, printers, …)', () => {
    expect(parseSsdpResponses([ROUTER])).toEqual([]);
  });

  it('dedupes by host across multiple responses', () => {
    expect(parseSsdpResponses([CAM, CAM])).toEqual([{ hostname: '192.168.1.50' }]);
  });

  it('skips responses with no/invalid/non-http LOCATION', () => {
    expect(parseSsdpResponses([resp(['ST: ipcam', 'SERVER: camera'])])).toEqual([]); // no LOCATION
    expect(parseSsdpResponses([resp(['LOCATION: not a url', 'ST: camera'])])).toEqual([]);
    expect(parseSsdpResponses([resp(['LOCATION: ftp://1.2.3.4/x', 'ST: camera'])])).toEqual([]);
  });

  it('parses headers case-insensitively and ignores junk lines', () => {
    const r = resp(['garbage line', 'location: http://10.0.0.5/d.xml', 'Server: My IP Camera']);
    expect(parseSsdpResponses([r])).toEqual([{ hostname: '10.0.0.5' }]);
  });
});

// ---- IO wrapper ----
function createFakeSocket(opts: { closeThrows?: boolean } = {}) {
  const handlers: { message?: (m: Buffer) => void; error?: (e: Error) => void } = {};
  const send = vi.fn();
  const close = vi.fn(() => {
    if (opts.closeThrows) throw new Error('close failed');
  });
  const on = vi.fn((event: string, cb: (...a: unknown[]) => void) => {
    if (event === 'message') handlers.message = cb as (m: Buffer) => void;
    else if (event === 'error') handlers.error = cb as (e: Error) => void;
  });
  const socket = { on, send, close } as unknown as ISsdpSocket;
  const make = vi.fn(() => socket) as unknown as MakeSsdpSocket;
  return {
    make,
    on,
    send,
    close,
    emitMessage: (s: string) => handlers.message?.(Buffer.from(s)),
    emitError: (e = new Error('socket error')) => handlers.error?.(e),
  };
}

describe('createSsdpProbe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves to [] when the socket factory throws', async () => {
    const make = vi.fn(() => {
      throw new Error('EADDRINUSE');
    }) as unknown as MakeSsdpSocket;
    await expect(createSsdpProbe(make)(1000)).resolves.toEqual([]);
  });

  it('registers message + error handlers and sends an M-SEARCH to the SSDP group', () => {
    const fake = createFakeSocket();
    void createSsdpProbe(fake.make)(1000);
    expect(fake.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(fake.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(fake.send).toHaveBeenCalledTimes(1);
    const [buf, port, addr] = fake.send.mock.calls[0];
    expect(String(buf)).toContain('M-SEARCH');
    expect(port).toBe(1900);
    expect(addr).toBe('239.255.255.250');
  });

  it('collects a camera response and resolves on timeout, closing the socket', async () => {
    const fake = createFakeSocket();
    const pending = createSsdpProbe(fake.make)(2000);
    fake.emitMessage(CAM);
    expect(fake.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual([{ hostname: '192.168.1.50' }]);
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('finishes early and resolves on a socket error', async () => {
    const fake = createFakeSocket();
    const pending = createSsdpProbe(fake.make)(5000);
    fake.emitError();
    await expect(pending).resolves.toEqual([]);
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('still resolves when close() throws during teardown', async () => {
    const fake = createFakeSocket({ closeThrows: true });
    const pending = createSsdpProbe(fake.make)(1000);
    fake.emitMessage(CAM);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual([{ hostname: '192.168.1.50' }]);
  });
});
