import { createOnvifConnect, type IOnvifTarget } from './onvif-connect';
import { OnvifPtzController, type OnvifConnect } from './onvif-controller';

/**
 * Introspects a discovered ONVIF camera so the add-camera form arrives pre-filled instead of asking
 * a boater to hand-type an RTSP path. It drives the ONVIF capability surface (device info, stream and
 * snapshot URIs, PTZ/imaging/audio detection) and maps the result into auto-fill fields. The stream
 * URI the camera returns is re-validated through the SSRF guard before it is trusted — a hostile
 * device must not be able to point us at a forbidden host.
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
  /** The camera reports an audio output (speaker), so go2rtc native two-way audio (A4) is feasible. */
  audioBackchannel: boolean;
}

export interface IIntrospectDeps {
  /** Re-checks a host against the SSRF guard; rejects to block a disallowed address. */
  assertHostAllowed: (host: string) => Promise<void>;
  /** Injectable connect factory for testing. */
  connectFactory?: (target: IOnvifTarget) => OnvifConnect;
}

/** Stream schemes a camera-supplied URI may use (the camera resource allow-list, minus `onvif`). */
const STREAM_SCHEMES = new Set(['rtsp', 'rtsps', 'http', 'https', 'rtmp']);

export async function introspectOnvifCamera(
  input: IIntrospectInput,
  deps: IIntrospectDeps,
): Promise<IIntrospectResult> {
  // SSRF-check the device host BEFORE opening a connection to it.
  await deps.assertHostAllowed(input.host);

  const connect = (deps.connectFactory ?? createOnvifConnect)({
    hostname: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
  });
  const caps = await new OnvifPtzController(connect).probeCapabilities();

  const result: IIntrospectResult = {
    ptz: caps.absolutePtz,
    absolutePtz: caps.absolutePtz,
    imaging: caps.imaging,
    imagingControls: caps.imagingControls,
    audio: caps.audioOutput,
    // A speaker (audio output) is what makes go2rtc's native two-way audio backchannel feasible, so the
    // /talk route gates on this capability (set server-side from the ONVIF probe, never client-trusted).
    audioBackchannel: caps.audioOutput,
  };
  const info = caps.deviceInformation;
  if (info?.manufacturer) {
    result.manufacturer = info.manufacturer;
  }
  if (info?.model) {
    result.model = info.model;
  }
  if (info?.serialNumber) {
    result.serialNumber = info.serialNumber;
  }
  if (caps.snapshotUri) {
    result.snapshotUri = caps.snapshotUri;
  }
  if (caps.streamUri) {
    const source = await parseStreamSource(caps.streamUri, deps.assertHostAllowed);
    if (source) {
      result.source = source;
    }
  }
  return result;
}

/**
 * Parses a camera-returned stream URI into a structured source, or null if it is unusable. Credentials
 * are dropped (host only), the scheme must be allow-listed, and the host is re-checked through the
 * SSRF guard so a hostile device cannot redirect us to a forbidden address (DNS-rebind / SSRF).
 */
async function parseStreamSource(
  uri: string,
  assertHostAllowed: (host: string) => Promise<void>,
): Promise<IIntrospectSource | null> {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(/:$/, '');
  if (!STREAM_SCHEMES.has(scheme) || !parsed.hostname) {
    return null;
  }
  try {
    await assertHostAllowed(parsed.hostname);
  } catch {
    return null;
  }
  const source: IIntrospectSource = { scheme, host: parsed.hostname };
  if (parsed.port) {
    source.port = Number(parsed.port);
  }
  const path = `${parsed.pathname}${parsed.search}`;
  if (path && path !== '/') {
    source.path = path;
  }
  return source;
}
