import { describe, it, expect } from 'vitest';
import { validateCamera, CAMERA_SCHEMES } from './camera-validation';

const valid = {
  name: '  Foredeck Cam  ',
  source: { scheme: 'rtsp', host: '192.168.1.50', port: 554, path: '/stream1' },
};

describe('validateCamera', () => {
  it('accepts a well-formed camera and normalises it', () => {
    const r = validateCamera(valid);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.value).toEqual({
      name: 'Foredeck Cam',
      enabled: true,
      source: { scheme: 'rtsp', host: '192.168.1.50', port: 554, path: '/stream1' },
    });
  });

  it('accepts every allow-listed scheme', () => {
    for (const scheme of CAMERA_SCHEMES) {
      expect(validateCamera({ name: 'c', source: { scheme, host: 'cam.local' } }).valid).toBe(true);
    }
  });

  it('rejects dangerous go2rtc source schemes (the RCE guard)', () => {
    for (const scheme of ['exec', 'ffmpeg', 'pipe', 'file', 'tcp', 'javascript']) {
      const r = validateCamera({ name: 'c', source: { scheme, host: 'x' } });
      expect(r.valid, scheme).toBe(false);
    }
  });

  it('requires a non-empty name', () => {
    expect(validateCamera({ source: { scheme: 'rtsp', host: 'x' } }).valid).toBe(false);
    expect(validateCamera({ name: '   ', source: { scheme: 'rtsp', host: 'x' } }).valid).toBe(
      false,
    );
  });

  it('requires a host and rejects hosts with injection characters', () => {
    expect(validateCamera({ name: 'c', source: { scheme: 'rtsp' } }).valid).toBe(false);
    for (const host of ['has space', 'a/b', 'a@b', 'a?b', 'a\\b', 'a"b']) {
      expect(validateCamera({ name: 'c', source: { scheme: 'rtsp', host } }).valid, host).toBe(
        false,
      );
    }
  });

  it('rejects out-of-range or non-integer ports', () => {
    expect(
      validateCamera({ name: 'c', source: { scheme: 'rtsp', host: 'x', port: 0 } }).valid,
    ).toBe(false);
    expect(
      validateCamera({ name: 'c', source: { scheme: 'rtsp', host: 'x', port: 70000 } }).valid,
    ).toBe(false);
    expect(
      validateCamera({ name: 'c', source: { scheme: 'rtsp', host: 'x', port: 55.5 } }).valid,
    ).toBe(false);
  });

  it('rejects a path with traversal or control characters', () => {
    expect(
      validateCamera({ name: 'c', source: { scheme: 'rtsp', host: 'x', path: '/a/../b' } }).valid,
    ).toBe(false);
    expect(
      validateCamera({ name: 'c', source: { scheme: 'rtsp', host: 'x', path: 'no-leading-slash' } })
        .valid,
    ).toBe(false);
    expect(
      validateCamera({ name: 'c', source: { scheme: 'rtsp', host: 'x', path: '/a b' } }).valid,
    ).toBe(false);
  });

  it('rejects credentials embedded in the camera definition', () => {
    const r = validateCamera({
      name: 'c',
      password: 'secret',
      source: { scheme: 'rtsp', host: 'x' },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(validateCamera(null).valid).toBe(false);
    expect(validateCamera('rtsp://x').valid).toBe(false);
    expect(validateCamera(42).valid).toBe(false);
  });
});
