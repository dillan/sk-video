import {
  clampPtzVelocity,
  clampPtzPosition,
  isValidPtzToken,
  type IPtzVelocity,
  type IPtzPosition,
} from './ptz-command';

/** PTZ status in ONVIF normalized space. */
export interface IPtzStatus {
  pan: number;
  tilt: number;
  zoom: number;
}

export interface IDeviceInformation {
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  serialNumber: string;
  hardwareId: string;
}

/** Imaging settings as read from a camera (only the fields onvif@0.8.1 exposes). */
export interface IImagingSettings {
  brightness?: number;
  contrast?: number;
  colorSaturation?: number;
  sharpness?: number;
  /** Day/night IR-cut filter mode. */
  irCutFilter?: string;
  focus?: Record<string, unknown>;
  exposure?: Record<string, unknown>;
}

/** The subset of imaging settings this plugin can write (vendor-quirky; capability-gated). */
export interface IImagingUpdate {
  brightness?: number;
  contrast?: number;
  colorSaturation?: number;
  sharpness?: number;
  irCutFilter?: 'AUTO' | 'ON' | 'OFF';
}

/** Per-camera capabilities detected by probing the device — never assumed. */
export interface IDetectedCapabilities {
  deviceInformation: IDeviceInformation | null;
  streamUri: string | null;
  snapshotUri: string | null;
  /** Absolute PTZ pointing is available (getStatus returned a position). */
  absolutePtz: boolean;
  /** Imaging settings are readable. */
  imaging: boolean;
  /** Which imaging controls the camera actually exposes. */
  imagingControls: string[];
  /** The camera has an audio output (a speaker) — i.e. two-way audio is feasible. */
  audioOutput: boolean;
}

type Cb = (err?: Error | null) => void;

/** The subset of the onvif Cam API this plugin uses (callback style), behind our own interface. */
export interface IOnvifCam {
  continuousMove(options: { x: number; y: number; zoom: number }, cb: Cb): void;
  stop(options: { panTilt?: boolean; zoom?: boolean }, cb: Cb): void;
  getPresets(cb: (err: Error | null, presets?: Record<string, string>) => void): void;
  gotoPreset(options: { preset: string }, cb: Cb): void;
  absoluteMove(options: { x: number; y: number; zoom: number }, cb: Cb): void;
  relativeMove(options: { x: number; y: number; zoom: number }, cb: Cb): void;
  getStatus(
    options: Record<string, unknown>,
    cb: (
      err: Error | null,
      status?: { position?: { x?: number; y?: number; zoom?: number } },
    ) => void,
  ): void;
  getImagingSettings(
    options: Record<string, unknown>,
    cb: (err: Error | null, settings?: IImagingSettings) => void,
  ): void;
  setImagingSettings(options: Record<string, unknown>, cb: Cb): void;
  getStreamUri(
    options: Record<string, unknown>,
    cb: (err: Error | null, uri?: { uri?: string }) => void,
  ): void;
  getSnapshotUri(
    options: Record<string, unknown>,
    cb: (err: Error | null, uri?: { uri?: string }) => void,
  ): void;
  getDeviceInformation(cb: (err: Error | null, info?: IDeviceInformation) => void): void;
  getAudioOutputs(cb: (err: Error | null, outputs?: unknown[]) => void): void;
}

/** Connects to (or returns a connected) ONVIF camera. Injected so the controller is unit-testable. */
export type OnvifConnect = () => Promise<IOnvifCam>;

export interface IOnvifControllerOptions {
  /** Auto-stop a continuous move after this many ms if no explicit stop arrives (runaway safety). */
  autoStopMs?: number;
}

/**
 * Drives ONVIF PTZ + imaging + media for one camera. Velocities/positions are clamped, preset tokens
 * validated, and every continuous move arms an auto-stop so the camera can't run away if the client
 * never sends Stop. Absolute/relative moves are self-completing and need no auto-stop.
 */
export class OnvifPtzController {
  private autoStop: ReturnType<typeof setTimeout> | null = null;
  private readonly autoStopMs: number;

  constructor(
    private readonly connect: OnvifConnect,
    options: IOnvifControllerOptions = {},
  ) {
    this.autoStopMs = options.autoStopMs ?? 2000;
  }

  async move(velocity: Partial<IPtzVelocity>): Promise<void> {
    const v = clampPtzVelocity(velocity);
    const cam = await this.connect();
    await new Promise<void>((resolve, reject) => {
      cam.continuousMove({ x: v.pan, y: v.tilt, zoom: v.zoom }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    this.armAutoStop();
  }

  async stop(): Promise<void> {
    this.cancelAutoStop();
    const cam = await this.connect();
    await new Promise<void>((resolve, reject) => {
      cam.stop({ panTilt: true, zoom: true }, (err) => (err ? reject(err) : resolve()));
    });
  }

  async getPresets(): Promise<Record<string, string>> {
    const cam = await this.connect();
    return new Promise((resolve, reject) => {
      cam.getPresets((err, presets) => (err ? reject(err) : resolve(presets ?? {})));
    });
  }

  async gotoPreset(token: string): Promise<void> {
    if (!isValidPtzToken(token)) {
      throw new Error('invalid preset token');
    }
    const cam = await this.connect();
    await new Promise<void>((resolve, reject) => {
      cam.gotoPreset({ preset: token }, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Drive the camera to an absolute position (self-completing; no auto-stop needed). */
  async moveAbsolute(position: Partial<IPtzPosition>): Promise<void> {
    const p = clampPtzPosition(position);
    const cam = await this.connect();
    await new Promise<void>((resolve, reject) => {
      cam.absoluteMove({ x: p.pan, y: p.tilt, zoom: p.zoom }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  /** Nudge the camera by a relative delta (normalized -1..1 per axis; self-completing). */
  async moveRelative(delta: Partial<IPtzVelocity>): Promise<void> {
    const d = clampPtzVelocity(delta);
    const cam = await this.connect();
    await new Promise<void>((resolve, reject) => {
      cam.relativeMove({ x: d.pan, y: d.tilt, zoom: d.zoom }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async getStatus(): Promise<IPtzStatus> {
    const cam = await this.connect();
    return new Promise((resolve, reject) => {
      cam.getStatus({}, (err, status) => {
        if (err) {
          reject(err);
          return;
        }
        const pos = status?.position ?? {};
        resolve({ pan: pos.x ?? 0, tilt: pos.y ?? 0, zoom: pos.zoom ?? 0 });
      });
    });
  }

  async getImaging(): Promise<IImagingSettings> {
    const cam = await this.connect();
    return new Promise((resolve, reject) => {
      cam.getImagingSettings({}, (err, settings) => (err ? reject(err) : resolve(settings ?? {})));
    });
  }

  /** Write the supported imaging fields that were provided (capability-gated by the caller). */
  async setImaging(update: IImagingUpdate): Promise<void> {
    const options: Record<string, unknown> = {};
    for (const key of SETTABLE_IMAGING) {
      if (update[key] !== undefined) {
        options[key] = update[key];
      }
    }
    const cam = await this.connect();
    await new Promise<void>((resolve, reject) => {
      cam.setImagingSettings(options, (err) => (err ? reject(err) : resolve()));
    });
  }

  async getStreamUri(protocol = 'RTSP'): Promise<string> {
    const cam = await this.connect();
    return new Promise((resolve, reject) => {
      cam.getStreamUri({ protocol }, (err, uri) => (err ? reject(err) : resolve(uri?.uri ?? '')));
    });
  }

  async getSnapshotUri(): Promise<string> {
    const cam = await this.connect();
    return new Promise((resolve, reject) => {
      cam.getSnapshotUri({}, (err, uri) => (err ? reject(err) : resolve(uri?.uri ?? '')));
    });
  }

  async getDeviceInformation(): Promise<IDeviceInformation> {
    const cam = await this.connect();
    return new Promise((resolve, reject) => {
      cam.getDeviceInformation((err, info) =>
        err ? reject(err) : resolve(info ?? EMPTY_DEVICE_INFO),
      );
    });
  }

  private async getAudioOutputs(): Promise<unknown[]> {
    const cam = await this.connect();
    return new Promise((resolve, reject) => {
      cam.getAudioOutputs((err, outputs) => (err ? reject(err) : resolve(outputs ?? [])));
    });
  }

  /**
   * Probe what this specific camera actually supports. Each optional feature is attempted and any
   * error is treated as "unsupported" — capabilities are detected, never assumed.
   */
  async probeCapabilities(): Promise<IDetectedCapabilities> {
    const [device, streamUri, snapshotUri, imaging, status, audio] = await Promise.all([
      this.getDeviceInformation().catch(() => null),
      this.getStreamUri().catch(() => null),
      this.getSnapshotUri().catch(() => null),
      this.getImaging().catch(() => null),
      this.getStatus().catch(() => null),
      this.getAudioOutputs().catch(() => null),
    ]);
    return {
      deviceInformation: device,
      streamUri: streamUri || null,
      snapshotUri: snapshotUri || null,
      absolutePtz: status !== null,
      imaging: imaging !== null,
      imagingControls: imaging ? imagingControlsOf(imaging) : [],
      audioOutput: Array.isArray(audio) && audio.length > 0,
    };
  }

  /** Stops motion and cancels any pending auto-stop (call on teardown). */
  dispose(): void {
    this.cancelAutoStop();
  }

  private armAutoStop(): void {
    this.cancelAutoStop();
    this.autoStop = setTimeout(() => {
      void this.stop().catch(() => undefined);
    }, this.autoStopMs);
  }

  private cancelAutoStop(): void {
    if (this.autoStop) {
      clearTimeout(this.autoStop);
      this.autoStop = null;
    }
  }
}

/** The imaging fields onvif@0.8.1 lets us write (no WDR/defog/backlight in this library version). */
const SETTABLE_IMAGING = [
  'irCutFilter',
  'brightness',
  'contrast',
  'colorSaturation',
  'sharpness',
] as const satisfies readonly (keyof IImagingUpdate)[];

const EMPTY_DEVICE_INFO: IDeviceInformation = {
  manufacturer: '',
  model: '',
  firmwareVersion: '',
  serialNumber: '',
  hardwareId: '',
};

/** Maps the imaging settings a camera returned to the control names it actually exposes. */
const IMAGING_CONTROL_KEYS: readonly [keyof IImagingSettings, string][] = [
  ['irCutFilter', 'irCut'],
  ['brightness', 'brightness'],
  ['contrast', 'contrast'],
  ['colorSaturation', 'colorSaturation'],
  ['sharpness', 'sharpness'],
  ['focus', 'focus'],
  ['exposure', 'exposure'],
];

function imagingControlsOf(settings: IImagingSettings): string[] {
  return IMAGING_CONTROL_KEYS.filter(([key]) => settings[key] !== undefined).map(
    ([, name]) => name,
  );
}
