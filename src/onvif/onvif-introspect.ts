import type { IOnvifTarget } from './onvif-connect';
import type { OnvifConnect } from './onvif-controller';

/**
 * Introspects a discovered ONVIF camera so the add-camera form arrives pre-filled instead of asking
 * a boater to hand-type an RTSP path. It drives the ONVIF capability surface (device info, stream and
 * snapshot URIs, PTZ/imaging/audio detection) and maps the result into auto-fill fields. The stream
 * URI the camera returns is re-validated through the SSRF guard before it is trusted — a hostile
 * device must not be able to point us at a forbidden host.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface IIntrospectInput {
  host: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface IIntrospectSource {
  scheme: string;
  host: string;
  port?: number;
  path?: string;
}

export interface IIntrospectResult {
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  /** Auto-filled stream source, present only when a usable, SSRF-allowed URI was obtained. */
  source?: IIntrospectSource;
  snapshotUri?: string;
  ptz: boolean;
  absolutePtz: boolean;
  imaging: boolean;
  imagingControls: string[];
  audio: boolean;
}

export interface IIntrospectDeps {
  /** Re-checks a host against the SSRF guard; rejects to block a disallowed address. */
  assertHostAllowed: (host: string) => Promise<void>;
  /** Injectable connect factory for testing. */
  connectFactory?: (target: IOnvifTarget) => OnvifConnect;
}

export async function introspectOnvifCamera(
  _input: IIntrospectInput,
  _deps: IIntrospectDeps,
): Promise<IIntrospectResult> {
  return { ptz: false, absolutePtz: false, imaging: false, imagingControls: [], audio: false };
}
