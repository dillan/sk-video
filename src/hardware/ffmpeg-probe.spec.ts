import { describe, it, expect } from 'vitest';
import {
  probeFfmpegHwaccel,
  parseHwaccels,
  parseH264Encoders,
  type TFfmpegRunner,
} from './ffmpeg-probe';

const HWACCELS = `Hardware acceleration methods:
vdpau
vaapi
drm
`;

const ENCODERS = `Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC
 V....D h264_vaapi           H.264/AVC (VAAPI)
 V....D hevc_vaapi           H.265/HEVC (VAAPI)
 A..... aac                  AAC
`;

/** A runner that answers each ffmpeg query from a fixture keyed by its distinguishing flag. */
const runnerFrom =
  (hwaccels: string, encoders: string): TFfmpegRunner =>
  (args) =>
    Promise.resolve(args.includes('-hwaccels') ? hwaccels : encoders);

describe('parseHwaccels', () => {
  it('lists the methods after the header', () => {
    expect(parseHwaccels(HWACCELS)).toEqual(['vdpau', 'vaapi', 'drm']);
  });
  it('returns nothing when the header is absent (ffmpeg missing / errored)', () => {
    expect(parseHwaccels('')).toEqual([]);
    expect(parseHwaccels('ffmpeg: command not found')).toEqual([]);
  });
});

describe('parseH264Encoders', () => {
  it('finds hardware H.264 encoders and ignores software libx264', () => {
    expect(parseH264Encoders(ENCODERS)).toEqual(['h264_vaapi']);
  });
  it('finds the Pi V4L2 M2M encoder', () => {
    expect(parseH264Encoders(' V....D h264_v4l2m2m   V4L2 mem2mem H.264')).toEqual([
      'h264_v4l2m2m',
    ]);
  });
  it('returns nothing for a software-only ffmpeg', () => {
    expect(parseH264Encoders(' V....D libx264   libx264 H.264')).toEqual([]);
  });
});

describe('probeFfmpegHwaccel', () => {
  it('reports a usable hardware H.264 encode path on a VAAPI host', async () => {
    const info = await probeFfmpegHwaccel(runnerFrom(HWACCELS, ENCODERS));
    expect(info.ffmpegPresent).toBe(true);
    expect(info.methods).toContain('vaapi');
    expect(info.h264Encoders).toEqual(['h264_vaapi']);
    expect(info.hardwareEncode).toBe(true);
  });

  it('reports no hardware encode on a software-only ffmpeg', async () => {
    const info = await probeFfmpegHwaccel(runnerFrom('', ' V....D libx264  libx264 H.264'));
    expect(info.hardwareEncode).toBe(false);
    expect(info.h264Encoders).toEqual([]);
  });

  it('fails closed when ffmpeg is absent (both queries empty)', async () => {
    const info = await probeFfmpegHwaccel(() => Promise.resolve(''));
    expect(info.ffmpegPresent).toBe(false);
    expect(info.hardwareEncode).toBe(false);
    expect(info.methods).toEqual([]);
  });
});
