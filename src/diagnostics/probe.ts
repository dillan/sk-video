/**
 * Camera connection test ("does this camera answer, and what is it sending?"). The probe runs
 * `ffprobe` against the constructed source URL with a hard protocol allow-list — it is never a shell
 * command, and ffprobe can't be redirected to local files. Pure helpers here; the actual process and
 * socket I/O live in probe-runner.ts so this stays unit-testable.
 */

/** The outcome of a single connection test, safe to return to the browser. */
export interface IProbeResult {
  ok: boolean;
  codec?: string;
  width?: number;
  height?: number;
  message: string;
}

/** Raw result of running ffprobe (from the injected runner). */
export interface IFfprobeOutcome {
  /** Process exit code, or null if it never started. */
  code: number | null;
  /** True if the runner had to kill ffprobe for taking too long. */
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export type TFfprobeRunner = (args: string[], timeoutMs: number) => Promise<IFfprobeOutcome>;
export type TTcpProbe = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

// Network protocols ffprobe may use. Deliberately excludes `file`, `concat`, `subfile`, etc. so a
// hostile stream can't redirect the probe at the server's filesystem.
const PROTOCOL_ALLOW_LIST = 'rtsp,rtsps,rtp,rtcp,udp,tcp,tls,https,http,crypto,rtmp,rtmps';

/** Builds the ffprobe argument vector for a source URL. Passed to spawn as args — never a shell. */
export function buildFfprobeArgs(sourceUrl: string, timeoutMs: number): string[] {
  const micros = Math.max(1, Math.round(timeoutMs * 1000));
  return [
    '-v',
    'error',
    '-hide_banner',
    '-protocol_whitelist',
    PROTOCOL_ALLOW_LIST,
    '-rw_timeout',
    String(micros), // socket read/write timeout in microseconds
    '-analyzeduration',
    String(micros),
    '-select_streams',
    'v:0', // first video stream only
    '-show_entries',
    'stream=codec_name,width,height',
    '-of',
    'json',
    sourceUrl,
  ];
}

/** Parses the first video stream out of ffprobe's JSON, or null if there isn't one. */
export function parseFfprobeStreams(
  stdout: string,
): { codec?: string; width?: number; height?: number } | null {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const streams = (data as { streams?: unknown }).streams;
  if (!Array.isArray(streams) || streams.length === 0) {
    return null;
  }
  const s = streams[0] as { codec_name?: unknown; width?: unknown; height?: unknown };
  return {
    codec: typeof s.codec_name === 'string' ? s.codec_name : undefined,
    width: typeof s.width === 'number' ? s.width : undefined,
    height: typeof s.height === 'number' ? s.height : undefined,
  };
}

/** Turns an ffprobe run into a user-facing result. */
export function evaluateFfprobe(outcome: IFfprobeOutcome): IProbeResult {
  if (outcome.timedOut) {
    return { ok: false, message: 'No response from the camera (timed out).' };
  }
  if (outcome.code !== 0) {
    return { ok: false, message: 'Could not reach the camera or read its video.' };
  }
  const stream = parseFfprobeStreams(outcome.stdout);
  if (!stream || !stream.codec) {
    return { ok: false, message: 'Connected, but found no video stream.' };
  }
  const size = stream.width && stream.height ? `${stream.width}×${stream.height} ` : '';
  return {
    ok: true,
    codec: stream.codec,
    width: stream.width,
    height: stream.height,
    message: `Reachable — ${size}${stream.codec.toUpperCase()}`.trim(),
  };
}

/** Result for an ONVIF device, tested by a plain TCP reachability check (ffprobe can't read onvif://). */
export function evaluateTcp(reachable: boolean): IProbeResult {
  return reachable
    ? { ok: true, message: 'ONVIF device reachable.' }
    : { ok: false, message: 'No response from the ONVIF device.' };
}
