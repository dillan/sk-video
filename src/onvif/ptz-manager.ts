import type { ICamera } from '../cameras/camera-validation';
import type { ICameraCredentials } from '../gateway/go2rtc-source';
import {
  OnvifPtzController,
  type OnvifConnect,
  type IDetectedCapabilities,
} from './onvif-controller';
import { createOnvifConnect, type IOnvifTarget } from './onvif-connect';

export class CameraNotFoundError extends Error {}

export interface IPtzManagerDeps {
  getCamera: (id: string) => ICamera | null;
  getCredentials: (id: string) => ICameraCredentials | null;
  /** SSRF-checks the camera host; rejects to block a disallowed address. */
  assertHostAllowed: (host: string) => Promise<void>;
  /** Injectable connect factory for testing. */
  connectFactory?: (target: IOnvifTarget) => OnvifConnect;
}

/**
 * Owns one ONVIF PTZ controller per camera, creating it on first use (after an SSRF host check) and
 * caching it. Controllers are disposed when their camera changes or the plugin stops.
 */
export class PtzManager {
  private readonly controllers = new Map<string, OnvifPtzController>();
  private readonly capabilities = new Map<string, IDetectedCapabilities>();
  private readonly connectFactory: (target: IOnvifTarget) => OnvifConnect;

  constructor(private readonly deps: IPtzManagerDeps) {
    this.connectFactory = deps.connectFactory ?? createOnvifConnect;
  }

  /**
   * Detected capabilities for a camera, probed once on first use and cached until the camera changes.
   * NOTE: stubbed — behaviour is added in the GREEN step.
   */
  async capabilitiesFor(_id: string): Promise<IDetectedCapabilities> {
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

  async controllerFor(id: string): Promise<OnvifPtzController> {
    const existing = this.controllers.get(id);
    if (existing) {
      return existing;
    }
    const camera = this.deps.getCamera(id);
    if (!camera) {
      throw new CameraNotFoundError(`unknown camera ${id}`);
    }
    await this.deps.assertHostAllowed(camera.source.host);

    const creds = this.deps.getCredentials(id);
    const port = camera.source.scheme === 'onvif' ? camera.source.port : undefined;
    const connect = this.connectFactory({
      hostname: camera.source.host,
      port,
      username: creds?.username,
      password: creds?.password,
    });
    const controller = new OnvifPtzController(connect);
    this.controllers.set(id, controller);
    return controller;
  }

  invalidate(id: string): void {
    this.controllers.get(id)?.dispose();
    this.controllers.delete(id);
  }

  disposeAll(): void {
    for (const controller of this.controllers.values()) {
      controller.dispose();
    }
    this.controllers.clear();
  }
}
