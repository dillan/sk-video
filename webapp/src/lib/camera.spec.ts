import { describe, it, expect } from 'vitest';
import { cameraSubtitle, cameraTileView } from './camera';
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

describe('cameraTileView', () => {
  it('reports a disabled camera as disabled and dimmed', () => {
    const v = cameraTileView({ ...base, enabled: false });
    expect(v).toEqual({ state: 'disabled', label: 'Disabled', dim: true });
  });
  it('reports an enabled camera as connecting (no fabricated live state)', () => {
    const v = cameraTileView(base);
    expect(v.state).toBe('connecting');
    expect(v.dim).toBe(false);
  });
});
