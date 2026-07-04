import { describe, it, expect, vi } from 'vitest';
import { parseStreamHealth, fetchStreamHealth, fetchAllStreamsHealth } from './stream-health';

const sample = {
  producers: [
    {
      url: 'rtsp://admin:secret@192.168.1.50:554/h264',
      medias: [
        { kind: 'video', direction: 'recvonly', codecs: [{ name: 'H264' }] },
        { kind: 'audio', direction: 'recvonly', codecs: [{ name: 'PCMA' }] },
      ],
    },
  ],
  consumers: [{ medias: [{ kind: 'video', codecs: [{ name: 'H264' }] }] }],
};

describe('parseStreamHealth', () => {
  it('maps producers/consumers/codecs and redacts source credentials', () => {
    const h = parseStreamHealth(sample, 'cam');
    expect(h).toMatchObject({ online: true, producers: 1, consumers: 1 });
    expect(h.codecs.sort()).toEqual(['H264', 'PCMA']);
    expect(h.sources).toHaveLength(1);
    expect(h.sources[0]).not.toContain('secret');
    expect(h.sources[0]).toContain('***@192.168.1.50');
  });

  it('accepts the go2rtc shape keyed by stream name', () => {
    expect(parseStreamHealth({ cam: sample }, 'cam')).toMatchObject({ online: true, producers: 1 });
  });

  it('reports not-online with no producer (lazy source / no viewer)', () => {
    expect(parseStreamHealth({ producers: [], consumers: [] }, 'cam')).toEqual({
      online: false,
      producers: 0,
      consumers: 0,
      codecs: [],
      sources: [],
    });
  });

  it('does not count a configured-but-unconnected producer as online', () => {
    // go2rtc lists every CONFIGURED source as a producer entry; only a connected one carries
    // connection detail (remote_addr / medias / id). A dead camera go2rtc keeps retrying must
    // read offline, or the watchdog can never fire (verified against go2rtc 1.9 in the e2e).
    const configuredOnly = { producers: [{ url: 'rtsp://mediamtx:8554/no-such-stream' }] };
    expect(parseStreamHealth(configuredOnly, 'cam')).toMatchObject({
      online: false,
      producers: 0,
    });
    // ...but the (redacted) source URL still surfaces for diagnostics.
    expect(parseStreamHealth(configuredOnly, 'cam').sources).toHaveLength(1);

    const connected = {
      producers: [{ url: 'rtsp://mediamtx:8554/cam', remote_addr: '172.19.0.2:8554' }],
    };
    expect(parseStreamHealth(connected, 'cam')).toMatchObject({ online: true, producers: 1 });
  });

  it('tolerates missing/garbage JSON without throwing', () => {
    for (const raw of [
      null,
      undefined,
      42,
      {},
      { producers: 'nope' },
      { cam: { producers: [{}] } },
      // non-object producers, non-object medias, and a non-string codec name
      { producers: [5, { medias: [7, { codecs: [9, { name: 42 }] }] }] },
    ]) {
      expect(() => parseStreamHealth(raw, 'cam')).not.toThrow();
    }
    // An empty producer entry carries no connection evidence — configured at best, not online.
    expect(parseStreamHealth({ cam: { producers: [{}] } }, 'cam').online).toBe(false);
  });
});

describe('fetchStreamHealth', () => {
  it('fetches the loopback /api/streams URL for the camera and returns parsed health', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: () => Promise.resolve(sample) });
    const h = await fetchStreamHealth({ apiPort: 1984, cameraId: 'cam', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:1984/api/streams?src=cam', {
      signal: expect.any(AbortSignal),
    });
    expect(h).toMatchObject({ online: true, producers: 1 });
    expect(h.codecs).toContain('H264');
  });
});

describe('fetchAllStreamsHealth', () => {
  it('reads /api/streams once and parses every requested camera (missing ids read offline)', async () => {
    const all = {
      cam: {
        producers: [{ url: 'rtsp://user:pw@10.0.0.2/main', remote_addr: '10.0.0.2:554' }],
        consumers: [],
      },
      cam_sub: { producers: [], consumers: [] },
    };
    const fetchImpl = vi.fn().mockResolvedValue({ json: () => Promise.resolve(all) });
    const healths = await fetchAllStreamsHealth({
      apiPort: 1984,
      cameraIds: ['cam', 'ghost'],
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:1984/api/streams', {
      signal: expect.any(AbortSignal),
    });
    expect(healths.cam.online).toBe(true);
    expect(healths.cam.sources).toEqual(['rtsp://***@10.0.0.2/main']);
    expect(healths.ghost).toMatchObject({ online: false, producers: 0 });
  });
});
