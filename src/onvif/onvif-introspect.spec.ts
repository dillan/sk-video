import { describe, it, expect, vi } from 'vitest';
import { introspectOnvifCamera, type IIntrospectDeps } from './onvif-introspect';
import type { IOnvifCam } from './onvif-controller';

/** A fake ONVIF cam exposing just what probeCapabilities drives, with per-feature toggles. */
function fakeCam(over: Partial<Record<string, unknown>> = {}): IOnvifCam {
  const o = {
    streamUri: 'rtsp://192.168.1.50:554/Streaming/Channels/101',
    snapshotUri: 'http://192.168.1.50/snap.jpg',
    failStatus: false,
    audioOutputs: [{ token: 'AO1' }] as unknown[],
    profiles: [] as unknown[],
    streamUriByToken: {} as Record<string, string>,
    ...over,
  } as {
    streamUri: string;
    snapshotUri: string;
    failStatus: boolean;
    audioOutputs: unknown[];
    profiles: unknown[];
    streamUriByToken: Record<string, string>;
  };
  return {
    continuousMove: (_o, cb) => cb(null),
    stop: (_o, cb) => cb(null),
    getPresets: (cb) => cb(null, {}),
    gotoPreset: (_o, cb) => cb(null),
    absoluteMove: (_o, cb) => cb(null),
    relativeMove: (_o, cb) => cb(null),
    getStatus: (_o, cb) =>
      o.failStatus ? cb(new Error('no ptz')) : cb(null, { position: { x: 0, y: 0, zoom: 0 } }),
    getImagingSettings: (_o, cb) => cb(null, { irCutFilter: 'AUTO', brightness: 50 }),
    setImagingSettings: (_o, cb) => cb(null),
    getStreamUri: (opts, cb) => {
      const token = (opts as { profileToken?: string }).profileToken;
      cb(null, { uri: (token && o.streamUriByToken[token]) || o.streamUri });
    },
    getProfiles: (cb) => cb(null, o.profiles as never),
    getSnapshotUri: (_o, cb) => cb(null, { uri: o.snapshotUri }),
    getDeviceInformation: (cb) =>
      cb(null, {
        manufacturer: 'Acme',
        model: 'Dome 2MP',
        firmwareVersion: '1.0',
        serialNumber: 'SN123',
        hardwareId: 'HW1',
      }),
    getAudioOutputs: (cb) => cb(null, o.audioOutputs),
  };
}

/** A camera that advertises an H.265 main + an H.264 sub on the same RTSP endpoint (the Reolink shape). */
const PROFILED = {
  streamUri: 'rtsp://192.168.1.50:554/Preview_01_main',
  profiles: [
    {
      $: { token: 'main' },
      name: 'Main',
      videoEncoderConfiguration: { encoding: 'H265', resolution: { width: 3840, height: 2160 } },
    },
    {
      $: { token: 'sub' },
      name: 'Sub',
      videoEncoderConfiguration: { encoding: 'H264', resolution: { width: 640, height: 480 } },
    },
  ],
  streamUriByToken: {
    main: 'rtsp://192.168.1.50:554/Preview_01_main',
    sub: 'rtsp://192.168.1.50:554/Preview_01_sub',
  },
};

function deps(over: Partial<IIntrospectDeps> = {}): IIntrospectDeps {
  return {
    assertHostAllowed: async () => undefined,
    connectFactory: () => async () => fakeCam(),
    ...over,
  };
}

describe('introspectOnvifCamera', () => {
  it('auto-fills the source, snapshot, identity and capabilities from a healthy camera', async () => {
    const result = await introspectOnvifCamera({ host: '192.168.1.50', port: 8000 }, deps());
    expect(result).toMatchObject({
      manufacturer: 'Acme',
      model: 'Dome 2MP',
      serialNumber: 'SN123',
      snapshotUri: 'http://192.168.1.50/snap.jpg',
      source: { scheme: 'rtsp', host: '192.168.1.50', port: 554, path: '/Streaming/Channels/101' },
      absolutePtz: true,
      imaging: true,
      audio: true,
      audioBackchannel: true,
    });
    expect(result.imagingControls).toContain('irCut');
  });

  it('reports no two-way audio backchannel when the camera has no audio output (speaker)', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({ connectFactory: () => async () => fakeCam({ audioOutputs: [] }) }),
    );
    expect(result.audioBackchannel).toBe(false);
  });

  it('SSRF-checks the device host before connecting and rejects a blocked host', async () => {
    const connectFactory = vi.fn(() => async () => fakeCam());
    await expect(
      introspectOnvifCamera(
        { host: '169.254.169.254' },
        deps({
          assertHostAllowed: async (h) => {
            if (h === '169.254.169.254') throw new Error('blocked host');
          },
          connectFactory,
        }),
      ),
    ).rejects.toThrow(/blocked/);
    expect(connectFactory).not.toHaveBeenCalled();
  });

  it('drops the auto-filled source when the camera returns a stream URI on a forbidden host', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({
        connectFactory: () => async () => fakeCam({ streamUri: 'rtsp://169.254.169.254:554/evil' }),
        assertHostAllowed: async (h) => {
          if (h === '169.254.169.254') throw new Error('blocked stream host');
        },
      }),
    );
    expect(result.source).toBeUndefined(); // the rest still came through
    expect(result.snapshotUri).toBe('http://192.168.1.50/snap.jpg');
  });

  it('omits the source for a non-allow-listed stream scheme', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({ connectFactory: () => async () => fakeCam({ streamUri: 'ftp://192.168.1.50/x' }) }),
    );
    expect(result.source).toBeUndefined();
  });

  it('reports no PTZ when status is unavailable on a fixed camera', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({ connectFactory: () => async () => fakeCam({ failStatus: true }) }),
    );
    expect(result.absolutePtz).toBe(false);
    expect(result.ptz).toBe(false);
  });

  it('captures all profiles, the main codec, and the H.264 substream path', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({ connectFactory: () => async () => fakeCam(PROFILED) }),
    );
    // source stays the main (recording) stream; codec is reported so the player can route around H.265
    expect(result.source).toMatchObject({ path: '/Preview_01_main' });
    expect(result.codec).toBe('h265');
    // the lower-res H.264 profile on the same endpoint becomes the browser-decodable substream
    expect(result.substreams).toBe(true);
    expect(result.substreamPath).toBe('/Preview_01_sub');
    expect(result.streams?.map((s) => ({ codec: s.codec, path: s.source.path }))).toEqual([
      { codec: 'h265', path: '/Preview_01_main' },
      { codec: 'h264', path: '/Preview_01_sub' },
    ]);
  });

  it('does not adopt a substream that resolves to a forbidden host', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({
        connectFactory: () => async () =>
          fakeCam({
            ...PROFILED,
            streamUriByToken: {
              main: 'rtsp://192.168.1.50:554/Preview_01_main',
              sub: 'rtsp://169.254.169.254:554/Preview_01_sub',
            },
          }),
        assertHostAllowed: async (h) => {
          if (h === '169.254.169.254') throw new Error('blocked');
        },
      }),
    );
    expect(result.source).toMatchObject({ path: '/Preview_01_main' });
    expect(result.substreams).toBeFalsy();
    expect(result.substreamPath).toBeUndefined();
    expect(result.streams?.map((s) => s.source.host)).toEqual(['192.168.1.50']); // sub dropped
  });

  it('flags no substream when the camera exposes only a single H.264 profile', async () => {
    const result = await introspectOnvifCamera(
      { host: '192.168.1.50' },
      deps({
        connectFactory: () => async () =>
          fakeCam({
            streamUri: 'rtsp://192.168.1.50:554/only',
            profiles: [
              {
                $: { token: 'main' },
                name: 'Main',
                videoEncoderConfiguration: {
                  encoding: 'H264',
                  resolution: { width: 1920, height: 1080 },
                },
              },
            ],
            streamUriByToken: { main: 'rtsp://192.168.1.50:554/only' },
          }),
      }),
    );
    expect(result.codec).toBe('h264');
    expect(result.substreams).toBeFalsy();
    expect(result.substreamPath).toBeUndefined();
  });
});
