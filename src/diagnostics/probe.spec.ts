import { describe, it, expect } from 'vitest';
import { buildFfprobeArgs, parseFfprobeStreams, evaluateFfprobe, evaluateTcp } from './probe';

describe('buildFfprobeArgs', () => {
  it('puts the source url last and never enables the file protocol', () => {
    const args = buildFfprobeArgs('rtsp://cam.local:554/stream', 8000);
    expect(args[args.length - 1]).toBe('rtsp://cam.local:554/stream');
    const wl = args[args.indexOf('-protocol_whitelist') + 1];
    expect(wl).not.toContain('file');
    expect(wl).toContain('rtsp');
    expect(args).toContain('-of');
    expect(args[args.indexOf('-of') + 1]).toBe('json');
  });

  it('passes the timeout to ffprobe in microseconds', () => {
    const args = buildFfprobeArgs('rtsp://h/s', 8000);
    expect(args[args.indexOf('-rw_timeout') + 1]).toBe('8000000');
  });
});

describe('parseFfprobeStreams', () => {
  it('reads codec and resolution from the first video stream', () => {
    const out = JSON.stringify({ streams: [{ codec_name: 'h264', width: 1280, height: 720 }] });
    expect(parseFfprobeStreams(out)).toEqual({ codec: 'h264', width: 1280, height: 720 });
  });

  it('returns null for no streams, an empty array, or invalid JSON', () => {
    expect(parseFfprobeStreams(JSON.stringify({ streams: [] }))).toBeNull();
    expect(parseFfprobeStreams(JSON.stringify({}))).toBeNull();
    expect(parseFfprobeStreams('not json')).toBeNull();
  });
});

describe('evaluateFfprobe', () => {
  it('reports a timeout', () => {
    expect(evaluateFfprobe({ code: null, timedOut: true, stdout: '', stderr: '' })).toEqual({
      ok: false,
      message: 'No response from the camera (timed out).',
    });
  });

  it('reports an unreachable camera on a non-zero exit', () => {
    const r = evaluateFfprobe({ code: 1, timedOut: false, stdout: '', stderr: 'fail' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Could not reach');
  });

  it('reports success with codec and resolution', () => {
    const stdout = JSON.stringify({ streams: [{ codec_name: 'h264', width: 1920, height: 1080 }] });
    const r = evaluateFfprobe({ code: 0, timedOut: false, stdout, stderr: '' });
    expect(r.ok).toBe(true);
    expect(r.codec).toBe('h264');
    expect(r.width).toBe(1920);
    expect(r.message).toContain('1920×1080');
    expect(r.message).toContain('H264');
  });

  it('reports connected-but-no-video when the exit is clean but there is no stream', () => {
    const r = evaluateFfprobe({ code: 0, timedOut: false, stdout: '{"streams":[]}', stderr: '' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('no video stream');
  });
});

describe('evaluateTcp', () => {
  it('maps reachability to a result', () => {
    expect(evaluateTcp(true)).toEqual({ ok: true, message: 'ONVIF device reachable.' });
    expect(evaluateTcp(false).ok).toBe(false);
  });
});
