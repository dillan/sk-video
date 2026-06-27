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
 *
 * NOTE: the absolute/relative/status/imaging/media/capability methods are stubbed — behaviour is
 * added in the GREEN step.
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

  // --- stubs (GREEN adds behaviour) ---

  async moveAbsolute(_position: Partial<IPtzPosition>): Promise<void> {
    void clampPtzPosition;
  }

  async moveRelative(_delta: Partial<IPtzVelocity>): Promise<void> {
    // no-op stub
  }

  async getStatus(): Promise<IPtzStatus> {
    return { pan: 0, tilt: 0, zoom: 0 };
  }

  async getImaging(): Promise<IImagingSettings> {
    return {};
  }

  async setImaging(_update: IImagingUpdate): Promise<void> {
    // no-op stub
  }

  async getStreamUri(_protocol?: string): Promise<string> {
    return '';
  }

  async getSnapshotUri(): Promise<string> {
    return '';
  }

  async getDeviceInformation(): Promise<IDeviceInformation> {
    return { manufacturer: '', model: '', firmwareVersion: '', serialNumber: '', hardwareId: '' };
  }

  async probeCapabilities(): Promise<IDetectedCapabilities> {
    return {
      deviceInformation: null,
      streamUri: null,
      snapshotUri: null,
      absolutePtz: false,
      imaging: false,
      imagingControls: [],
      audioOutput: false,
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
