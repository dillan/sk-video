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

  it('rejects a non-boolean enabled flag', () => {
    const r = validateCamera({
      name: 'c',
      enabled: 'true',
      source: { scheme: 'rtsp', host: 'x' },
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('enabled must be a boolean');
  });

  it('rejects a source that is not a plain object', () => {
    for (const source of [null, ['rtsp', 'x'], 'rtsp://x']) {
      const r = validateCamera({ name: 'c', source });
      expect(r.valid, JSON.stringify(source)).toBe(false);
      expect(r.errors, JSON.stringify(source)).toContain('source is required');
    }
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

describe('validateCamera — vessel-context metadata', () => {
  const base = { name: 'Cam', source: { scheme: 'rtsp', host: 'cam.local' } };

  it('accepts and normalises placement, role, capabilities, media and calibration', () => {
    const r = validateCamera({
      ...base,
      placement: { mount: 'mast', bearingRelativeDeg: 90, heightM: 12 },
      role: 'anchor',
      capabilities: { ptz: true, absolutePtz: true, imaging: ['irCut', 'wdr'], audio: false },
      media: { codec: 'h265', profileToken: 'profile_1', substreamPath: '/sub' },
      calibration: {
        pan: { offset: 0, scalePerDeg: 0.01 },
        tilt: { offset: -0.1, scalePerDeg: 0.02 },
      },
    });
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({
      placement: { mount: 'mast', bearingRelativeDeg: 90, heightM: 12 },
      role: 'anchor',
      capabilities: { ptz: true, absolutePtz: true, imaging: ['irCut', 'wdr'], audio: false },
      media: { codec: 'h265', profileToken: 'profile_1', substreamPath: '/sub' },
      calibration: {
        pan: { offset: 0, scalePerDeg: 0.01 },
        tilt: { offset: -0.1, scalePerDeg: 0.02 },
      },
    });
  });

  it('still accepts a minimal camera and omits absent metadata', () => {
    const r = validateCamera(base);
    expect(r.valid).toBe(true);
    expect(r.value).not.toHaveProperty('placement');
    expect(r.value).not.toHaveProperty('calibration');
  });

  it('rejects an unknown mount, an out-of-range bearing and a negative height', () => {
    expect(validateCamera({ ...base, placement: { mount: 'satellite' } }).valid).toBe(false);
    expect(validateCamera({ ...base, placement: { bearingRelativeDeg: 400 } }).valid).toBe(false);
    expect(validateCamera({ ...base, placement: { heightM: -1 } }).valid).toBe(false);
  });

  it('rejects an unexpected placement sub-field (the field set stays closed)', () => {
    expect(validateCamera({ ...base, placement: { mount: 'bow', tilt: 5 } }).valid).toBe(false);
  });

  it('rejects an unknown role', () => {
    expect(validateCamera({ ...base, role: 'teleporter' }).valid).toBe(false);
  });

  it('rejects bad capability values, imaging controls and unknown capability keys', () => {
    expect(validateCamera({ ...base, capabilities: { ptz: 'yes' } }).valid).toBe(false);
    expect(validateCamera({ ...base, capabilities: { imaging: ['xray'] } }).valid).toBe(false);
    expect(validateCamera({ ...base, capabilities: { bogus: true } }).valid).toBe(false);
  });

  it('rejects an unknown codec, a bad profile token and a traversal substream path', () => {
    expect(validateCamera({ ...base, media: { codec: 'av1' } }).valid).toBe(false);
    expect(validateCamera({ ...base, media: { profileToken: 'bad token!' } }).valid).toBe(false);
    expect(validateCamera({ ...base, media: { substreamPath: '/a/../b' } }).valid).toBe(false);
  });

  it('rejects a calibration missing an axis or with non-finite coefficients', () => {
    expect(
      validateCamera({ ...base, calibration: { pan: { offset: 0, scalePerDeg: 0.01 } } }).valid,
    ).toBe(false);
    expect(
      validateCamera({
        ...base,
        calibration: {
          pan: { offset: 0, scalePerDeg: 0.01 },
          tilt: { offset: 0, scalePerDeg: Infinity },
        },
      }).valid,
    ).toBe(false);
  });

  it('rejects metadata blocks that are not objects', () => {
    expect(validateCamera({ ...base, placement: 'mast' }).valid).toBe(false);
    expect(validateCamera({ ...base, capabilities: [] }).valid).toBe(false);
    expect(validateCamera({ ...base, media: 5 }).valid).toBe(false);
    expect(validateCamera({ ...base, calibration: null }).valid).toBe(false);
    expect(validateCamera({ ...base, calibration: { pan: 'x', tilt: 'y' } }).valid).toBe(false);
  });

  it('accepts an allowSelfSigned opt-in and rejects a non-boolean', () => {
    expect(validateCamera({ ...base, allowSelfSigned: true }).value).toMatchObject({
      allowSelfSigned: true,
    });
    expect(validateCamera({ ...base, allowSelfSigned: 'yes' }).valid).toBe(false);
  });

  it('still rejects credentials even alongside valid metadata', () => {
    expect(validateCamera({ ...base, role: 'anchor', password: 'secret' }).valid).toBe(false);
  });
});
