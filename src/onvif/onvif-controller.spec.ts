import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OnvifPtzController,
  type IOnvifCam,
  type IOnvifProfile,
  type IImagingSettings,
  type IDeviceInformation,
} from './onvif-controller';

class FakeCam implements IOnvifCam {
  moves: { x: number; y: number; zoom: number }[] = [];
  absMoves: { x: number; y: number; zoom: number }[] = [];
  relMoves: { x: number; y: number; zoom: number }[] = [];
  imagingWrites: Record<string, unknown>[] = [];
  streamUriOptions: Record<string, unknown>[] = [];
  stops = 0;
  gotos: string[] = [];
  presets: Record<string, string> | undefined = { Preset1: 'token-1' };

  // configurable returns
  status: { position?: { x?: number; y?: number; zoom?: number } } = {
    position: { x: 0.1, y: -0.2, zoom: 0.3 },
  };
  imaging: IImagingSettings = { brightness: 50, irCutFilter: 'AUTO', focus: {} };
  streamUri = 'rtsp://cam/stream1';
  snapshotUri = 'http://cam/snap.jpg';
  profiles: IOnvifProfile[] = [
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
  ];
  streamUriByToken: Record<string, string> = {
    main: 'rtsp://cam:554/main',
    sub: 'rtsp://cam:554/sub',
  };
  deviceInfo: IDeviceInformation = {
    manufacturer: 'Acme',
    model: 'Dome',
    firmwareVersion: '1.2',
    serialNumber: 'SN',
    hardwareId: 'HW',
  };
  audioOutputs: unknown[] = [{ token: 'AO1' }];

  // failure toggles
  failContinuous = false;
  failStop = false;
  failPresets = false;
  failGoto = false;
  failAbsolute = false;
  failImaging = false;
  failStatus = false;
  failStream = false;
  failAudio = false;
  failProfiles = false;

  continuousMove(o: { x: number; y: number; zoom: number }, cb: (err?: Error | null) => void) {
    this.moves.push(o);
    cb(this.failContinuous ? new Error('camera offline') : null);
  }
  stop(_o: { panTilt?: boolean; zoom?: boolean }, cb: (err?: Error | null) => void) {
    this.stops++;
    cb(this.failStop ? new Error('stop failed') : null);
  }
  getPresets(cb: (err: Error | null, presets?: Record<string, string>) => void) {
    cb(this.failPresets ? new Error('presets failed') : null, this.presets);
  }
  gotoPreset(o: { preset: string }, cb: (err?: Error | null) => void) {
    this.gotos.push(o.preset);
    cb(this.failGoto ? new Error('goto failed') : null);
  }
  absoluteMove(o: { x: number; y: number; zoom: number }, cb: (err?: Error | null) => void) {
    this.absMoves.push(o);
    cb(this.failAbsolute ? new Error('absolute failed') : null);
  }
  relativeMove(o: { x: number; y: number; zoom: number }, cb: (err?: Error | null) => void) {
    this.relMoves.push(o);
    cb(null);
  }
  getStatus(
    _o: Record<string, unknown>,
    cb: (
      err: Error | null,
      status?: { position?: { x?: number; y?: number; zoom?: number } },
    ) => void,
  ) {
    if (this.failStatus) cb(new Error('no status'));
    else cb(null, this.status);
  }
  getImagingSettings(
    _o: Record<string, unknown>,
    cb: (err: Error | null, settings?: IImagingSettings) => void,
  ) {
    if (this.failImaging) cb(new Error('no imaging'));
    else cb(null, this.imaging);
  }
  setImagingSettings(o: Record<string, unknown>, cb: (err?: Error | null) => void) {
    this.imagingWrites.push(o);
    cb(null);
  }
  getStreamUri(
    o: Record<string, unknown>,
    cb: (err: Error | null, uri?: { uri?: string }) => void,
  ) {
    this.streamUriOptions.push(o);
    if (this.failStream) {
      cb(new Error('no stream'));
      return;
    }
    const token = o.profileToken as string | undefined;
    cb(null, { uri: (token && this.streamUriByToken[token]) || this.streamUri });
  }
  getProfiles(cb: (err: Error | null, profiles?: IOnvifProfile[]) => void) {
    if (this.failProfiles) cb(new Error('no profiles'));
    else cb(null, this.profiles);
  }
  getSnapshotUri(
    _o: Record<string, unknown>,
    cb: (err: Error | null, uri?: { uri?: string }) => void,
  ) {
    cb(null, { uri: this.snapshotUri });
  }
  getDeviceInformation(cb: (err: Error | null, info?: IDeviceInformation) => void) {
    cb(null, this.deviceInfo);
  }
  getAudioOutputs(cb: (err: Error | null, outputs?: unknown[]) => void) {
    if (this.failAudio) cb(new Error('no audio'));
    else cb(null, this.audioOutputs);
  }
}

afterEach(() => vi.useRealTimers());
const control = (cam: IOnvifCam) => new OnvifPtzController(async () => cam);

describe('OnvifPtzController — continuous PTZ', () => {
  it('clamps the velocity and issues a continuous move', async () => {
    const cam = new FakeCam();
    await control(cam).move({ pan: 5, tilt: -0.5, zoom: 9 });
    expect(cam.moves).toEqual([{ x: 1, y: -0.5, zoom: 1 }]);
  });

  it('stops motion', async () => {
    const cam = new FakeCam();
    await control(cam).stop();
    expect(cam.stops).toBe(1);
  });

  it('propagates a camera error from a move', async () => {
    const cam = new FakeCam();
    cam.failContinuous = true;
    await expect(control(cam).move({ pan: 1 })).rejects.toThrow(/offline/);
  });

  it('propagates a camera error from stop', async () => {
    const cam = new FakeCam();
    cam.failStop = true;
    await expect(control(cam).stop()).rejects.toThrow(/stop failed/);
  });

  it('auto-stops a continuous move after the timeout', async () => {
    vi.useFakeTimers();
    const cam = new FakeCam();
    const c = new OnvifPtzController(async () => cam, { autoStopMs: 1500 });
    await c.move({ pan: 1 });
    expect(cam.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(cam.stops).toBe(1);
  });
});

describe('OnvifPtzController — presets', () => {
  it('rejects an invalid preset token before contacting the camera', async () => {
    const cam = new FakeCam();
    await expect(control(cam).gotoPreset('<bad>')).rejects.toThrow();
    expect(cam.gotos).toEqual([]);
  });

  it('goes to a valid preset and lists presets', async () => {
    const cam = new FakeCam();
    const c = control(cam);
    await c.gotoPreset('token-1');
    expect(cam.gotos).toEqual(['token-1']);
    expect(await c.getPresets()).toEqual({ Preset1: 'token-1' });
  });

  it('propagates a camera error from getPresets', async () => {
    const cam = new FakeCam();
    cam.failPresets = true;
    await expect(control(cam).getPresets()).rejects.toThrow(/presets failed/);
  });

  it('returns an empty map when the device reports no presets', async () => {
    const cam = new FakeCam();
    cam.presets = undefined;
    expect(await control(cam).getPresets()).toEqual({});
  });

  it('propagates a camera error from gotoPreset', async () => {
    const cam = new FakeCam();
    cam.failGoto = true;
    await expect(control(cam).gotoPreset('token-1')).rejects.toThrow(/goto failed/);
  });
});

describe('OnvifPtzController — absolute & relative pointing', () => {
  it('clamps an absolute position (pan/tilt to [-1,1], zoom to [0,1]) and issues absoluteMove', async () => {
    const cam = new FakeCam();
    await control(cam).moveAbsolute({ pan: 5, tilt: -2, zoom: 9 });
    expect(cam.absMoves).toEqual([{ x: 1, y: -1, zoom: 1 }]);
    await control(cam).moveAbsolute({ pan: -0.5, tilt: 0.25, zoom: -3 });
    expect(cam.absMoves[1]).toEqual({ x: -0.5, y: 0.25, zoom: 0 }); // zoom is one-sided
  });

  it('clamps a relative delta to [-1,1] and issues relativeMove', async () => {
    const cam = new FakeCam();
    await control(cam).moveRelative({ pan: 2, tilt: -0.3, zoom: -9 });
    expect(cam.relMoves).toEqual([{ x: 1, y: -0.3, zoom: -1 }]);
  });

  it('propagates a camera error from an absolute move', async () => {
    const cam = new FakeCam();
    cam.failAbsolute = true;
    await expect(control(cam).moveAbsolute({ pan: 0.1 })).rejects.toThrow(/absolute failed/);
  });

  it('reads the current normalised status, defaulting missing axes to 0', async () => {
    const cam = new FakeCam();
    expect(await control(cam).getStatus()).toEqual({ pan: 0.1, tilt: -0.2, zoom: 0.3 });
    cam.status = {};
    expect(await control(cam).getStatus()).toEqual({ pan: 0, tilt: 0, zoom: 0 });
  });
});

describe('OnvifPtzController — imaging', () => {
  it('reads imaging settings', async () => {
    const cam = new FakeCam();
    expect(await control(cam).getImaging()).toMatchObject({ brightness: 50, irCutFilter: 'AUTO' });
  });

  it('writes only the supported imaging fields that were provided', async () => {
    const cam = new FakeCam();
    await control(cam).setImaging({ irCutFilter: 'ON', brightness: 60 });
    expect(cam.imagingWrites).toEqual([{ irCutFilter: 'ON', brightness: 60 }]);
  });
});

describe('OnvifPtzController — media & device', () => {
  it('reads the stream uri with the requested protocol', async () => {
    const cam = new FakeCam();
    expect(await control(cam).getStreamUri('RTSP')).toBe('rtsp://cam/stream1');
    expect(cam.streamUriOptions[0]).toMatchObject({ protocol: 'RTSP' });
  });

  it('reads the snapshot uri and device information', async () => {
    const cam = new FakeCam();
    const c = control(cam);
    expect(await c.getSnapshotUri()).toBe('http://cam/snap.jpg');
    expect(await c.getDeviceInformation()).toMatchObject({ manufacturer: 'Acme', model: 'Dome' });
  });
});

describe('OnvifPtzController — capability probe', () => {
  it('detects the capabilities a camera actually exposes', async () => {
    const caps = await control(new FakeCam()).probeCapabilities();
    expect(caps).toMatchObject({
      absolutePtz: true,
      imaging: true,
      audioOutput: true,
      streamUri: 'rtsp://cam/stream1',
      snapshotUri: 'http://cam/snap.jpg',
      deviceInformation: { manufacturer: 'Acme' },
    });
    expect(caps.imagingControls).toEqual(['irCut', 'brightness', 'focus']);
  });

  it('degrades gracefully when optional features error out', async () => {
    const cam = new FakeCam();
    cam.failImaging = true;
    cam.failStatus = true;
    cam.failAudio = true;
    cam.failStream = true;
    cam.audioOutputs = [];
    const caps = await control(cam).probeCapabilities();
    expect(caps).toMatchObject({
      absolutePtz: false,
      imaging: false,
      audioOutput: false,
      streamUri: null,
      imagingControls: [],
    });
    // device info and snapshot still succeeded
    expect(caps.snapshotUri).toBe('http://cam/snap.jpg');
    // every per-profile stream URI errored too, so no streams could be captured
    expect(caps.streams).toEqual([]);
  });
});

describe('OnvifPtzController — profile enumeration', () => {
  it('lists the media profiles the camera advertises', async () => {
    const profiles = await control(new FakeCam()).getProfiles();
    expect(profiles.map((p) => p.$?.token)).toEqual(['main', 'sub']);
  });

  it('captures every profile stream with its codec, resolution and per-profile URI', async () => {
    const caps = await control(new FakeCam()).probeCapabilities();
    expect(caps.streams).toEqual([
      {
        profileToken: 'main',
        name: 'Main',
        codec: 'h265',
        width: 3840,
        height: 2160,
        uri: 'rtsp://cam:554/main',
      },
      {
        profileToken: 'sub',
        name: 'Sub',
        codec: 'h264',
        width: 640,
        height: 480,
        uri: 'rtsp://cam:554/sub',
      },
    ]);
  });

  it('skips a profile that has no usable token, keeping the rest', async () => {
    const cam = new FakeCam();
    cam.profiles = [{ name: 'Tokenless' }, ...cam.profiles]; // a profile with no $.token
    const caps = await control(cam).probeCapabilities();
    expect(caps.streams.map((s) => s.profileToken)).toEqual(['main', 'sub']);
  });

  it('returns no streams when profile enumeration fails', async () => {
    const cam = new FakeCam();
    cam.failProfiles = true;
    expect((await control(cam).probeCapabilities()).streams).toEqual([]);
  });
});
