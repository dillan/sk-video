import { describe, it, expect, vi } from 'vitest';
import { connectWithPortProbe, DEFAULT_ONVIF_PORTS } from './onvif-connect';
import type { IOnvifCam } from './onvif-controller';

const cam = {} as IOnvifCam;

describe('connectWithPortProbe', () => {
  it('uses only the configured port when one is given (no probing)', async () => {
    const open = vi.fn(async () => cam);
    await connectWithPortProbe({ hostname: 'h', port: 8000 }, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ port: 8000 }));
  });

  it('probes the common ports in order and returns the first that connects (Reolink on 8000)', async () => {
    const open = vi.fn(async (t: { port?: number }) => {
      if (t.port !== 8000) throw new Error('Wrong ONVIF SOAP response'); // :80 hits the web server
      return cam;
    });
    const result = await connectWithPortProbe({ hostname: 'h' }, open);
    expect(result).toBe(cam);
    // 80 tried first (and failed), then 8000 (succeeded) — no need to try the rest.
    expect(open.mock.calls.map((c) => c[0].port)).toEqual([80, 8000]);
  });

  it('throws the LAST error when every candidate port fails', async () => {
    const open = vi.fn(async (t: { port?: number }) => {
      throw new Error(`fail ${t.port}`);
    });
    await expect(connectWithPortProbe({ hostname: 'h' }, open)).rejects.toThrow(
      `fail ${DEFAULT_ONVIF_PORTS[DEFAULT_ONVIF_PORTS.length - 1]}`,
    );
    expect(open).toHaveBeenCalledTimes(DEFAULT_ONVIF_PORTS.length);
  });
});
