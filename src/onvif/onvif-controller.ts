import { clampPtzVelocity, isValidPtzToken, type IPtzVelocity } from './ptz-command';

/** The subset of the onvif Cam PTZ API this plugin uses (callback style), behind our own interface. */
export interface IOnvifCam {
  continuousMove(
    options: { x: number; y: number; zoom: number },
    cb: (err?: Error | null) => void,
  ): void;
  stop(options: { panTilt?: boolean; zoom?: boolean }, cb: (err?: Error | null) => void): void;
  getPresets(cb: (err: Error | null, presets?: Record<string, string>) => void): void;
  gotoPreset(options: { preset: string }, cb: (err?: Error | null) => void): void;
}

/** Connects to (or returns a connected) ONVIF camera. Injected so the controller is unit-testable. */
export type OnvifConnect = () => Promise<IOnvifCam>;

export interface IOnvifControllerOptions {
  /** Auto-stop a continuous move after this many ms if no explicit stop arrives (runaway safety). */
  autoStopMs?: number;
}

/**
 * Drives ONVIF PTZ for one camera. Velocities are clamped, preset tokens validated, and every
 * continuous move arms an auto-stop so the camera can't run away if the client never sends Stop.
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
