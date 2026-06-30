import { createOnvifConnect, type IOnvifTarget } from './onvif-connect';
import { OnvifPtzController, type OnvifConnect, type IDetectedStream } from './onvif-controller';

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

/** A single advertised media profile, parsed + SSRF-checked (forbidden-host profiles are dropped). */
export interface IIntrospectStream {
  /** Normalised codec: 'h264' | 'h265' | 'mjpeg', or the raw lowercased encoding when unrecognised. */
  codec: string;
  width?: number;
  height?: number;
  source: IIntrospectSource;
  profileToken?: string;
  name?: string;
}

export interface IIntrospectResult {
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  /** Auto-filled stream source, present only when a usable, SSRF-allowed URI was obtained. */
  source?: IIntrospectSource;
  /** Codec of the main (recording) stream — lets the UI route around H.265 in the browser. */
  codec?: string;
  /** Every SSRF-allowed media profile the camera advertises (main + any substreams). */
  streams?: IIntrospectStream[];
  /** Path of a browser-decodable H.264 substream on the SAME endpoint as `source`, when one exists. */
  substreamPath?: string;
  /** True when a usable H.264 substream was found (drives capabilities.substreams + the `_sub` stream). */
  substreams?: boolean;
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

  // Enumerate every advertised profile (each SSRF-checked) so we can offer a browser-decodable H.264
  // substream when the main stream is H.265 — which Chrome can't decode for live view by any transport.
  const streams = await parseStreams(caps.streams, deps.assertHostAllowed);
  if (streams.length > 0) {
    result.streams = streams;
  }
  const main = pickMainStream(streams, result.source);
  if (main?.codec) {
    result.codec = main.codec;
  }
  // The substream must sit on the SAME endpoint as the main source (the go2rtc config reuses the main
  // scheme/host/port and only swaps the path), so it can never repoint at a different host.
  const sub = pickSubstream(streams, result.source);
  if (sub?.source.path) {
    result.substreamPath = sub.source.path;
    result.substreams = true;
  }
  return result;
}

/** Pixel area of a stream (0 when the resolution is unknown), used to rank main vs substream. */
function streamArea(s: IIntrospectStream): number {
  return (s.width ?? 0) * (s.height ?? 0);
}

/** Same network endpoint (scheme/host/port) — the path is what distinguishes main from substream. */
function sameEndpoint(a: IIntrospectSource, b: IIntrospectSource): boolean {
  return a.scheme === b.scheme && a.host === b.host && a.port === b.port;
}

/** SSRF-parse each detected stream, dropping any that resolve to a forbidden host or bad scheme. */
async function parseStreams(
  detected: IDetectedStream[],
  assertHostAllowed: (host: string) => Promise<void>,
): Promise<IIntrospectStream[]> {
  const out: IIntrospectStream[] = [];
  for (const d of detected) {
    const source = await parseStreamSource(d.uri, assertHostAllowed);
    if (!source) {
      continue;
    }
    const stream: IIntrospectStream = { codec: d.codec, source };
    if (d.width !== undefined) {
      stream.width = d.width;
    }
    if (d.height !== undefined) {
      stream.height = d.height;
    }
    if (d.profileToken) {
      stream.profileToken = d.profileToken;
    }
    if (d.name) {
      stream.name = d.name;
    }
    out.push(stream);
  }
  return out;
}

/** The recording stream: the one matching the camera's default source, else the highest resolution. */
function pickMainStream(
  streams: IIntrospectStream[],
  source: IIntrospectSource | undefined,
): IIntrospectStream | undefined {
  if (source) {
    const match = streams.find(
      (s) => sameEndpoint(s.source, source) && s.source.path === source.path,
    );
    if (match) {
      return match;
    }
  }
  return [...streams].sort((a, b) => streamArea(b) - streamArea(a))[0];
}

/** A distinct H.264 stream on the main's endpoint — the smallest, since the substream is for low-res
 * grid tiles and the browser-decodable fallback when the main is H.265. */
function pickSubstream(
  streams: IIntrospectStream[],
  mainSource: IIntrospectSource | undefined,
): IIntrospectStream | undefined {
  if (!mainSource) {
    return undefined;
  }
  const candidates = streams.filter(
    (s) =>
      s.codec === 'h264' &&
      !!s.source.path &&
      s.source.path !== mainSource.path &&
      sameEndpoint(s.source, mainSource),
  );
  return [...candidates].sort((a, b) => streamArea(a) - streamArea(b))[0];
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
