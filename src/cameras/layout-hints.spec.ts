import { describe, it, expect } from 'vitest';
import { computeLayoutHints, sectorOf, suggestGrid } from './layout-hints';
import type { ICamera } from './camera-validation';

const cam = (over: Partial<ICamera> & { name: string }): ICamera => ({
  enabled: true,
  source: { scheme: 'rtsp', host: 'c' },
  ...over,
});

describe('sectorOf', () => {
  it('uses the bearing when present (0=forward, clockwise quadrants)', () => {
    expect(sectorOf(cam({ name: 'a', placement: { bearingRelativeDeg: 0 } }))).toBe('forward');
    expect(sectorOf(cam({ name: 'a', placement: { bearingRelativeDeg: 90 } }))).toBe('starboard');
    expect(sectorOf(cam({ name: 'a', placement: { bearingRelativeDeg: 180 } }))).toBe('aft');
    expect(sectorOf(cam({ name: 'a', placement: { bearingRelativeDeg: 270 } }))).toBe('port');
    expect(sectorOf(cam({ name: 'a', placement: { bearingRelativeDeg: 350 } }))).toBe('forward');
  });

  it('falls back to the mount, then to unknown', () => {
    expect(sectorOf(cam({ name: 'a', placement: { mount: 'mast' } }))).toBe('overhead');
    expect(sectorOf(cam({ name: 'a', placement: { mount: 'stern' } }))).toBe('aft');
    expect(sectorOf(cam({ name: 'a' }))).toBe('unknown'); // no placement at all
  });

  it('prefers the bearing over the mount when both are present', () => {
    expect(sectorOf(cam({ name: 'a', placement: { mount: 'stern', bearingRelativeDeg: 0 } }))).toBe(
      'forward',
    );
  });
});

describe('suggestGrid', () => {
  it('returns a near-square grid that fits n feeds', () => {
    expect(suggestGrid(0)).toEqual({ rows: 0, cols: 0 });
    expect(suggestGrid(1)).toEqual({ rows: 1, cols: 1 });
    expect(suggestGrid(2)).toEqual({ rows: 1, cols: 2 });
    expect(suggestGrid(4)).toEqual({ rows: 2, cols: 2 });
    expect(suggestGrid(5)).toEqual({ rows: 2, cols: 3 });
    expect(suggestGrid(9)).toEqual({ rows: 3, cols: 3 });
  });
});

describe('computeLayoutHints', () => {
  const cameras: Record<string, ICamera> = {
    bow: cam({
      name: 'Bow',
      role: 'navigation',
      placement: { mount: 'bow' },
      safetyCritical: true,
    }),
    sterncam: cam({
      name: 'Stern',
      role: 'docking',
      placement: { mount: 'stern' },
      capabilities: { ptz: true },
    }),
    helm: cam({ name: 'Helm', placement: { mount: 'helm' } }), // no role -> default bucket
    off: cam({ name: 'Off', enabled: false, placement: { mount: 'bow' } }), // disabled -> excluded
  };

  it('excludes disabled cameras and orders the rest forward -> aft (then by name within a sector)', () => {
    const h = computeLayoutHints(cameras);
    // forward (Bow), then the two aft cameras alphabetically by name: "Helm" before "Stern".
    expect(h.cameras.map((c) => c.id)).toEqual(['bow', 'helm', 'sterncam']);
    expect(h.cameras.find((c) => c.id === 'helm')?.role).toBe('general'); // ungrouped default bucket
  });

  it('groups by role and sector', () => {
    const h = computeLayoutHints(cameras);
    expect(h.byRole).toEqual({ navigation: ['bow'], docking: ['sterncam'], general: ['helm'] });
    expect(h.bySector.forward).toEqual(['bow']);
    expect(h.bySector.aft.sort()).toEqual(['helm', 'sterncam']);
  });

  it('offers curated quick-select groups (only non-empty), incl. a Forward set for "show the foredeck"', () => {
    const h = computeLayoutHints(cameras);
    const byKey = Object.fromEntries(h.groups.map((g) => [g.key, g]));
    expect(byKey.all.cameraIds).toHaveLength(3);
    expect(byKey['sector:forward'].label).toBe('Forward');
    expect(byKey['sector:forward'].cameraIds).toEqual(['bow']);
    expect(byKey.ptz.cameraIds).toEqual(['sterncam']);
    expect(byKey.safety.cameraIds).toEqual(['bow']);
    expect(byKey['sector:port']).toBeUndefined(); // empty sectors are omitted
  });

  it('suggests a grid sized to the enabled-camera count', () => {
    expect(computeLayoutHints(cameras).suggestedGrid).toEqual({ rows: 2, cols: 2 }); // 3 enabled
    expect(computeLayoutHints({}).suggestedGrid).toEqual({ rows: 0, cols: 0 });
  });

  it('flags a 360 camera as panoramic and offers a panoramic quick-select (A2)', () => {
    const masthead: Record<string, ICamera> = {
      mast: cam({
        name: 'Masthead 360',
        placement: { mount: 'mast' },
        media: { projection: 'equirectangular' },
      }),
      bow: cam({ name: 'Bow', placement: { mount: 'bow' } }),
    };
    const h = computeLayoutHints(masthead);
    const mastEntry = h.cameras.find((c) => c.id === 'mast');
    expect(mastEntry).toMatchObject({ projection: 'equirectangular', panoramic: true });
    expect(h.cameras.find((c) => c.id === 'bow')).toMatchObject({
      projection: 'standard',
      panoramic: false,
    });
    expect(h.groups.find((g) => g.key === 'panoramic')?.cameraIds).toEqual(['mast']);
  });

  it('maps all sectors, an absolutePtz camera, a bearing entry, and placement-without-mount', () => {
    const mixed: Record<string, ICamera> = {
      p: cam({ name: 'Port', placement: { mount: 'port' } }),
      s: cam({ name: 'Stbd', placement: { mount: 'starboard' } }),
      m: cam({ name: 'Mast', placement: { mount: 'mast' } }),
      e: cam({ name: 'Engine', placement: { mount: 'engine' } }),
      brg: cam({ name: 'Brg', placement: { bearingRelativeDeg: 95 } }), // bearing -> starboard
      noMount: cam({ name: 'NoMount', placement: { heightM: 2 } }), // placement, no mount -> unknown
      absPtz: cam({ name: 'AbsPtz', capabilities: { absolutePtz: true } }),
    };
    const h = computeLayoutHints(mixed);
    expect(h.bySector.port).toEqual(['p']);
    expect(h.bySector.overhead).toEqual(['m']);
    expect(h.bySector.interior).toEqual(['e']);
    expect(h.bySector.starboard.sort()).toEqual(['brg', 's']);
    expect(h.bySector.unknown.sort()).toEqual(['absPtz', 'noMount']);
    expect(h.cameras.find((c) => c.id === 'noMount')?.mount).toBeNull();
    expect(h.cameras.find((c) => c.id === 'brg')?.bearingRelativeDeg).toBe(95);
    // absolutePtz alone counts as PTZ-capable for the quick-select group
    expect(h.groups.find((g) => g.key === 'ptz')?.cameraIds).toContain('absPtz');
  });
});
