import { describe, it, expect } from 'vitest';
import { cameraSubtitle, tileStatus } from './camera';
import type { ICamera } from '../api';

const base: ICamera = { name: 'Bow', enabled: true };

describe('cameraSubtitle', () => {
  it('builds a subtitle from placement and capabilities', () => {
    expect(
      cameraSubtitle({
        ...base,
        placement: { mount: 'bow', bearingRelativeDeg: 350 },
        capabilities: { substreams: true },
      }),
    ).toBe('Bow · 350° · substream');
  });
  it('omits unknown pieces', () => {
    expect(cameraSubtitle({ ...base, placement: { bearingRelativeDeg: 0 } })).toBe('000°');
    expect(cameraSubtitle(base)).toBe('');
  });
});

describe('tileStatus', () => {
  it('reports a disabled camera as disabled and dimmed', () => {
    expect(tileStatus({ ...base, enabled: false }, false, false)).toEqual({
      label: 'Disabled',
      tone: 'neutral',
      live: false,
      dim: true,
    });
  });
  it('is Live (with the live dot) only when a frame is actually playing', () => {
    const v = tileStatus(base, true, false);
    expect(v.label).toBe('Live');
    expect(v.tone).toBe('live');
    expect(v.live).toBe(true);
    expect(v.dim).toBe(false);
  });
  it('connects without fabricating a live state, then reports No signal after the grace period', () => {
    expect(tileStatus(base, false, false)).toMatchObject({ label: 'Connecting…', live: false });
    expect(tileStatus(base, false, true)).toMatchObject({ label: 'No signal', tone: 'caution' });
  });
  it('prefers Live over a lost-signal flag (a late frame wins)', () => {
    expect(tileStatus(base, true, true).label).toBe('Live');
  });
});
