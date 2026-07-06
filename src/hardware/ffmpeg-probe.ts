import { execFile } from 'node:child_process';

/**
 * What the host's ffmpeg can actually do for hardware transcoding. go2rtc shells out to the system
 * ffmpeg for its `#hardware` transcode sources, so this probes that same ffmpeg — the honest answer to
 * "is a hardware H.264 encoder available on this device?", rather than the device-node heuristic (a
 * present /dev/dri node is not proof of a usable encoder). Used to tell the operator whether the
 * opt-in hardware-acceleration toggle will actually change anything.
 */
export interface IFfmpegHwaccel {
  /** ffmpeg was found and runnable. Without it, go2rtc can't transcode at all. */
  ffmpegPresent: boolean;
  /** Hardware acceleration methods ffmpeg reports (`-hwaccels`): e.g. vaapi, cuda, v4l2m2m, drm. */
  methods: string[];
  /** Hardware H.264 encoders present (`-encoders`): e.g. h264_vaapi, h264_v4l2m2m, h264_videotoolbox. */
  h264Encoders: string[];
  /** A genuine hardware H.264 ENCODE path exists — the signal the acceleration toggle keys off. */
  hardwareEncode: boolean;
}

/** Runs an ffmpeg query and returns its combined stdout+stderr, or '' if ffmpeg is missing/failed. */
export type TFfmpegRunner = (args: readonly string[]) => Promise<string>;

// ffmpeg names hardware H.264 encoders `h264_<engine>`; libx264/libopenh264 are software (excluded).
const HW_H264_ENCODER = /\bh264_[a-z0-9]+\b/g;
const SOFTWARE_H264 = new Set(['h264_omx']); // OMX is a Pi legacy path go2rtc doesn't drive; ignore

const DEFAULT_RUNNER: TFfmpegRunner = (args) =>
  new Promise((resolve) => {
    execFile('ffmpeg', args as string[], { timeout: 5000 }, (_err, stdout, stderr) => {
      // A non-zero exit or a missing binary both resolve to whatever text we got (often ''): the
      // parsers below treat absent output as "no capability", so the probe always fails closed.
      resolve(`${stdout ?? ''}${stderr ?? ''}`);
    });
  });

/** Parse `ffmpeg -hwaccels`: a header line, then one method per line. */
export function parseHwaccels(output: string): string[] {
  const lines = output.split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => /hardware acceleration methods/i.test(l));
  if (start === -1) return [];
  return lines.slice(start + 1).filter((l) => /^[a-z0-9_]+$/.test(l));
}

/** Parse `ffmpeg -encoders` for hardware H.264 encoder names (h264_vaapi, h264_v4l2m2m, …). */
export function parseH264Encoders(output: string): string[] {
  const found = new Set<string>();
  for (const m of output.matchAll(HW_H264_ENCODER)) {
    if (!SOFTWARE_H264.has(m[0])) found.add(m[0]);
  }
  return [...found].sort();
}

/**
 * Probe the host ffmpeg for a usable hardware H.264 encode path. Fails closed: a missing or erroring
 * ffmpeg reports no capability rather than throwing, so startup never depends on the probe succeeding.
 */
export async function probeFfmpegHwaccel(
  runner: TFfmpegRunner = DEFAULT_RUNNER,
): Promise<IFfmpegHwaccel> {
  const [accelsOut, encodersOut] = await Promise.all([
    runner(['-hide_banner', '-hwaccels']),
    runner(['-hide_banner', '-encoders']),
  ]);
  const ffmpegPresent = accelsOut.length > 0 || encodersOut.length > 0;
  const methods = parseHwaccels(accelsOut);
  const h264Encoders = parseH264Encoders(encodersOut);
  return {
    ffmpegPresent,
    methods,
    h264Encoders,
    hardwareEncode: h264Encoders.length > 0,
  };
}
