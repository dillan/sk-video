import { describe, it, expect } from 'vitest';
import {
  isOnvifCandidate,
  rankCandidates,
  slugify,
  isValidSlug,
  draftFromIntrospect,
  draftFromEntry,
  toResourceBody,
  mergeRescan,
  mergeEdit,
  isStableSerial,
  draftFromHint,
  parseStreamUrl,
  parseGeolocation,
  plainStreamDraft,
  streamSchemeHints,
} from './onboard';
import type { ICandidate, IIntrospectResult, ICameraEntry } from '../api';

const onvif: ICandidate = {
  name: '192.168.1.100',
  host: '192.168.1.100',
  port: 8000,
  onvifUrl: 'http://192.168.1.100:8000/onvif/device_service',
};
const wsd: ICandidate = {
  name: 'arlo',
  host: 'arlo',
  port: 5357,
  onvifUrl: 'http://Arlo:5357/abc-guid',
};

describe('candidate classification + ranking', () => {
  it('treats a /onvif/ service as a camera and a WSD responder as not', () => {
    expect(isOnvifCandidate(onvif)).toBe(true);
    expect(isOnvifCandidate(wsd)).toBe(false);
    expect(isOnvifCandidate({ name: 'x', host: 'x' })).toBe(false);
  });
  it('ranks real ONVIF cameras ahead of WSD noise, stably', () => {
    expect(rankCandidates([wsd, onvif]).map((c) => c.host)).toEqual(['192.168.1.100', 'arlo']);
  });
});

describe('slugify / isValidSlug', () => {
  it('makes a URL-safe id', () => {
    expect(slugify('Reolink RLC-823S2')).toBe('reolink-rlc-823s2');
    expect(slugify('  !!!  ')).toBe('camera');
  });
  it('validates slugs', () => {
    expect(isValidSlug('reolink-mast')).toBe(true);
    expect(isValidSlug('Bad Slug')).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);
  });
});

const result: IIntrospectResult = {
  manufacturer: 'REOLINK',
  model: 'RLC-823S2',
  source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/Preview_01_main' },
  ptz: true,
  absolutePtz: true,
  imaging: true,
  imagingControls: ['irCut'],
  audio: true,
  audioBackchannel: true,
};

describe('draftFromIntrospect', () => {
  it('defaults the name from make + model and maps capabilities', () => {
    const d = draftFromIntrospect(result, '192.168.1.100');
    expect(d.name).toBe('REOLINK RLC-823S2');
    expect(d.id).toBe('reolink-rlc-823s2');
    expect(d.source.port).toBe(554);
    expect(d.capabilities).toEqual({
      ptz: true,
      absolutePtz: true,
      audio: true,
      audioBackchannel: true,
      substreams: false,
      spotlight: false,
      alarm: false,
      imaging: ['irCut'],
    });
    expect(d.media).toBeUndefined(); // this fixture carries no codec/substream
  });

  it('derives spotlight/alarm from advertised aux commands and stores the raw tokens', () => {
    const d = draftFromIntrospect(
      { ...result, spotlight: true, alarm: true, auxCommands: ['tt:WhiteLight', 'tt:Siren'] },
      '192.168.1.100',
    );
    expect(d.capabilities.spotlight).toBe(true);
    expect(d.capabilities.alarm).toBe(true);
    expect(d.capabilities.auxCommands).toEqual(['tt:WhiteLight', 'tt:Siren']);
  });

  it('persists the detected imaging controls (drives the Imaging capability badge)', () => {
    const d = draftFromIntrospect(
      { ...result, imaging: true, imagingControls: ['irCut', 'brightness', 'contrast'] },
      '192.168.1.100',
    );
    expect(d.capabilities.imaging).toEqual(['irCut', 'brightness', 'contrast']);
  });

  it('omits imaging when the camera exposed no imaging controls', () => {
    const d = draftFromIntrospect({ ...result, imaging: false, imagingControls: [] }, 'cam');
    expect(d.capabilities.imaging).toBeUndefined();
  });

  it('persists device identity + firmware from discovery', () => {
    const d = draftFromIntrospect(
      { ...result, manufacturer: 'REOLINK', serialNumber: 'ABC123', firmwareVersion: 'v3.1.0' },
      'cam',
    );
    expect(d.device).toMatchObject({
      manufacturer: 'REOLINK',
      serial: 'ABC123',
      firmware: 'v3.1.0',
    });
  });

  it('falls back to the host when make/model are absent', () => {
    expect(
      draftFromIntrospect({ ...result, manufacturer: undefined, model: undefined }, 'cam').name,
    ).toBe('cam');
  });

  it('captures the main codec, the H.264 substream path and the substreams capability', () => {
    const d = draftFromIntrospect(
      { ...result, codec: 'h265', substreamPath: '/Preview_01_sub', substreams: true },
      '192.168.1.100',
    );
    expect(d.capabilities.substreams).toBe(true);
    expect(d.media).toEqual({ codec: 'h265', substreamPath: '/Preview_01_sub' });
  });

  it('drops a codec the camera resource would not accept, keeping the substream path', () => {
    const d = draftFromIntrospect(
      { ...result, codec: 'mpeg4', substreamPath: '/sub', substreams: true },
      'cam',
    );
    expect(d.media).toEqual({ substreamPath: '/sub' }); // mpeg4 isn't an allowed media.codec
  });

  it('keeps a query-string substream path (Dahua-style) now that the validator accepts them', () => {
    const d = draftFromIntrospect(
      { ...result, codec: 'h265', substreamPath: '/sub?token=abc', substreams: true },
      'cam',
    );
    expect(d.capabilities.substreams).toBe(true);
    expect(d.media).toEqual({ codec: 'h265', substreamPath: '/sub?token=abc' });
  });

  it('still drops a genuinely unsafe substream path (fragment/traversal) so the camera saves', () => {
    const d = draftFromIntrospect(
      { ...result, codec: 'h265', substreamPath: '/sub#frag', substreams: true },
      'cam',
    );
    expect(d.capabilities.substreams).toBe(false);
    expect(d.media).toEqual({ codec: 'h265' });
  });
});

describe('toResourceBody', () => {
  it('emits only the allowed fields and includes placement when set', () => {
    const body = toResourceBody({
      ...draftFromIntrospect(result, '192.168.1.100'),
      role: 'security',
      mount: 'mast',
      bearingRelativeDeg: 90,
    });
    expect(body).toEqual({
      name: 'REOLINK RLC-823S2',
      enabled: true,
      source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/Preview_01_main' },
      capabilities: {
        ptz: true,
        absolutePtz: true,
        audio: true,
        audioBackchannel: true,
        substreams: false,
        spotlight: false,
        alarm: false,
        imaging: ['irCut'],
      },
      device: { manufacturer: 'REOLINK', model: 'RLC-823S2' },
      role: 'security',
      placement: { mount: 'mast', bearingRelativeDeg: 90 },
    });
  });
  it('omits placement entirely when neither mount nor bearing is set', () => {
    const body = toResourceBody(draftFromIntrospect(result, '192.168.1.100'));
    expect(body.placement).toBeUndefined();
    expect(body.role).toBeUndefined();
  });
  it('emits media (codec + substream path) when introspection captured one', () => {
    const body = toResourceBody(
      draftFromIntrospect(
        { ...result, codec: 'h265', substreamPath: '/Preview_01_sub', substreams: true },
        '192.168.1.100',
      ),
    );
    expect(body.media).toEqual({ codec: 'h265', substreamPath: '/Preview_01_sub' });
    expect(body.capabilities?.substreams).toBe(true);
  });
  it('omits media entirely when no codec or substream was captured', () => {
    const body = toResourceBody(draftFromIntrospect(result, '192.168.1.100'));
    expect(body.media).toBeUndefined();
  });
  it('honours an explicit enabled flag and defaults new cameras to enabled', () => {
    const draft = draftFromIntrospect(result, '192.168.1.100');
    expect(toResourceBody(draft).enabled).toBe(true);
    expect(toResourceBody({ ...draft, enabled: false }).enabled).toBe(false);
  });

  it('includes a declared sensor and a camera geolocation when set', () => {
    const draft = draftFromIntrospect(result, '192.168.1.100');
    const body = toResourceBody({
      ...draft,
      capabilities: { ...draft.capabilities, sensors: ['bearing'] },
      geolocation: { latitude: 37.8, longitude: -122.4, orientationDeg: 90 },
    });
    expect(body.capabilities?.sensors).toEqual(['bearing']);
    expect(body.geolocation).toEqual({ latitude: 37.8, longitude: -122.4, orientationDeg: 90 });
  });

  it('omits geolocation entirely when it is not set', () => {
    expect(
      toResourceBody(draftFromIntrospect(result, '192.168.1.100')).geolocation,
    ).toBeUndefined();
  });
});

describe('parseGeolocation (fixed-location form)', () => {
  it('returns no location and no error when every field is blank', () => {
    expect(parseGeolocation({})).toEqual({});
    expect(parseGeolocation({ latitude: '', longitude: '' })).toEqual({});
  });

  it('builds a geolocation from latitude/longitude, carrying elevation and heading', () => {
    expect(
      parseGeolocation({
        latitude: '37.8',
        longitude: '-122.4',
        elevationM: '15',
        orientationDeg: '90',
      }),
    ).toEqual({
      geolocation: { latitude: 37.8, longitude: -122.4, elevationM: 15, orientationDeg: 90 },
    });
  });

  it('errors when only one of latitude/longitude is filled (a fix needs both)', () => {
    expect(parseGeolocation({ latitude: '37.8' }).error).toBeTruthy();
    expect(parseGeolocation({ longitude: '-122.4' }).geolocation).toBeUndefined();
    // elevation/heading alone are meaningless without a position
    expect(parseGeolocation({ elevationM: '15' }).error).toBeTruthy();
  });

  it('errors on a non-numeric coordinate rather than silently dropping it', () => {
    expect(parseGeolocation({ latitude: 'north', longitude: '-122.4' }).error).toBeTruthy();
  });
});

describe('draftFromEntry (edit flow)', () => {
  const entry = {
    id: 'foredeck',
    name: 'My Foredeck',
    enabled: false,
    role: 'security',
    source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/main' },
    placement: { mount: 'mast', bearingRelativeDeg: 90, heightM: 4 },
    capabilities: { ptz: true, absolutePtz: true, substreams: true, imaging: ['irCut'] },
    media: { codec: 'h265', substreamPath: '/sub' },
    device: { manufacturer: 'REOLINK' },
  } as unknown as ICameraEntry;

  it('reads a declared sensor and a geolocation from the stored camera', () => {
    const d = draftFromEntry({
      ...entry,
      capabilities: { ...entry.capabilities, sensors: ['bearing'] },
      geolocation: { latitude: 1, longitude: 2, elevationM: 3 },
    } as unknown as ICameraEntry);
    expect(d.capabilities.sensors).toEqual(['bearing']);
    expect(d.geolocation).toEqual({ latitude: 1, longitude: 2, elevationM: 3 });
  });

  it('pre-fills the form fields from the stored camera, keeping the id and enabled state', () => {
    const d = draftFromEntry(entry);
    expect(d.id).toBe('foredeck');
    expect(d.name).toBe('My Foredeck');
    expect(d.enabled).toBe(false);
    expect(d.role).toBe('security');
    expect(d.mount).toBe('mast');
    expect(d.bearingRelativeDeg).toBe(90);
    expect(d.source).toEqual({ scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/main' });
    expect(d.capabilities.substreams).toBe(true);
    expect(d.capabilities.imaging).toEqual(['irCut']);
    expect(d.media).toEqual({ codec: 'h265', substreamPath: '/sub' });
  });

  it('drops an out-of-enum role/mount instead of feeding the dropdowns an invalid value', () => {
    const d = draftFromEntry({
      ...entry,
      role: 'made-up',
      placement: { mount: 'nowhere' },
    } as unknown as ICameraEntry);
    expect(d.role).toBeUndefined();
    expect(d.mount).toBeUndefined();
  });

  it('tolerates a minimal entry (no source/capabilities) without crashing the form', () => {
    const d = draftFromEntry({ id: 'x', name: 'X', enabled: true } as ICameraEntry);
    expect(d.source).toEqual({ scheme: 'rtsp', host: '' });
    expect(d.capabilities.ptz).toBe(false);
    expect(d.media).toBeUndefined();
  });
});

describe('mergeEdit (edit flow)', () => {
  // Mirrors the runtime object fetchCameras returns, including fields the web app doesn't model
  // (calibration, safetyCritical) that an edit must NEVER destroy.
  const existing = {
    id: 'foredeck',
    name: 'My Foredeck',
    enabled: true,
    role: 'security',
    source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/main' },
    placement: { mount: 'mast', bearingRelativeDeg: 90, heightM: 4 },
    calibration: { pan: { offset: 0, scalePerDeg: 0.01 } },
    safetyCritical: true,
    capabilities: { ptz: true, absolutePtz: true, substreams: true },
    media: { codec: 'h265', substreamPath: '/sub', projection: 'equirect' },
    device: { manufacturer: 'REOLINK' },
  } as unknown as ICameraEntry;

  it('applies the edited fields and preserves everything the form does not edit', () => {
    const body = mergeEdit(existing, {
      ...draftFromEntry(existing),
      name: 'Foredeck PTZ',
      enabled: false,
      role: 'docking',
      mount: 'bow',
      bearingRelativeDeg: 10,
      source: { scheme: 'rtsp', host: '10.0.0.5', port: 554, path: '/main' },
    });
    // Edited:
    expect(body.name).toBe('Foredeck PTZ');
    expect(body.enabled).toBe(false);
    expect(body.role).toBe('docking');
    expect(body.source.host).toBe('10.0.0.5');
    // heightM isn't on the form, so it survives alongside the new mount/bearing.
    expect(body.placement).toEqual({ mount: 'bow', bearingRelativeDeg: 10, heightM: 4 });
    // Preserved verbatim (capabilities, media incl. projection, device, unmodeled fields):
    expect(body.capabilities).toEqual({ ptz: true, absolutePtz: true, substreams: true });
    expect(body.media).toEqual({ codec: 'h265', substreamPath: '/sub', projection: 'equirect' });
    expect(body.device).toEqual({ manufacturer: 'REOLINK' });
    expect((body as unknown as Record<string, unknown>).calibration).toEqual({
      pan: { offset: 0, scalePerDeg: 0.01 },
    });
    expect((body as unknown as Record<string, unknown>).safetyCritical).toBe(true);
    // The body never carries the id — the caller PUTs to the existing id.
    expect(body).not.toHaveProperty('id');
  });

  it('clears role and placement when the form empties them', () => {
    const body = mergeEdit({ ...existing, placement: { mount: 'mast' } } as ICameraEntry, {
      ...draftFromEntry(existing),
      role: undefined,
      mount: undefined,
      bearingRelativeDeg: undefined,
    });
    expect(body.role).toBeUndefined();
    expect(body.placement).toBeUndefined();
  });

  it('keeps the stored enabled state when the draft does not carry one', () => {
    const d = draftFromEntry(existing);
    delete (d as { enabled?: boolean }).enabled;
    expect(mergeEdit(existing, d).enabled).toBe(true);
  });

  it('applies an edited geolocation + sensor and clears them when emptied, keeping ONVIF capabilities', () => {
    const withGeo = { ...existing, geolocation: { latitude: 1, longitude: 2 } } as ICameraEntry;
    const set = mergeEdit(withGeo, {
      ...draftFromEntry(withGeo),
      geolocation: { latitude: 10, longitude: 20, orientationDeg: 45 },
      capabilities: { ...draftFromEntry(withGeo).capabilities, sensors: ['bearing'] },
    });
    expect(set.geolocation).toEqual({ latitude: 10, longitude: 20, orientationDeg: 45 });
    expect(set.capabilities?.sensors).toEqual(['bearing']);
    expect(set.capabilities?.ptz).toBe(true); // ONVIF-derived caps preserved alongside the sensor edit

    const cleared = mergeEdit(withGeo, {
      ...draftFromEntry(withGeo),
      geolocation: undefined,
      capabilities: { ...draftFromEntry(withGeo).capabilities, sensors: [] },
    });
    expect(cleared.geolocation).toBeUndefined();
    expect(cleared.capabilities?.sensors).toBeUndefined();
  });
});

describe('mergeRescan', () => {
  // An already-onboarded camera, including fields the web app type doesn't model (calibration) that
  // must survive a re-scan — mirrors the runtime object fetchCameras returns.
  const existing = {
    id: 'foredeck',
    name: 'My Foredeck',
    enabled: true,
    role: 'security',
    source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/main' },
    placement: { mount: 'mast', bearingRelativeDeg: 90 },
    calibration: { pan: { offset: 0, scalePerDeg: 0.01 } },
    safetyCritical: true,
    capabilities: { ptz: true }, // stale — no spotlight/imaging yet
    media: { codec: 'h264', projection: 'equirect' },
  } as unknown as ICameraEntry;

  const fresh: IIntrospectResult = {
    ptz: true,
    absolutePtz: true,
    imaging: true,
    imagingControls: ['irCut', 'brightness'],
    audio: true,
    audioBackchannel: true,
    spotlight: true,
    alarm: true,
    auxCommands: ['tt:WhiteLight', 'tt:Siren'],
    firmwareVersion: 'v4.0.0',
    manufacturer: 'REOLINK',
  };

  it('refreshes discovered capabilities + device while preserving operator-set fields', () => {
    const body = mergeRescan(existing, fresh);
    // Refreshed from the scan:
    expect(body.capabilities?.spotlight).toBe(true);
    expect(body.capabilities?.imaging).toEqual(['irCut', 'brightness']);
    expect(body.device?.firmware).toBe('v4.0.0');
    // Preserved operator fields (incl. calibration + safetyCritical, which the web app type omits):
    expect(body.name).toBe('My Foredeck');
    expect(body.role).toBe('security');
    expect(body.placement).toEqual({ mount: 'mast', bearingRelativeDeg: 90 });
    expect((body as unknown as Record<string, unknown>).calibration).toEqual({
      pan: { offset: 0, scalePerDeg: 0.01 },
    });
    expect((body as unknown as Record<string, unknown>).safetyCritical).toBe(true);
    // A projection (360 geometry) the operator set is kept even though the scan doesn't report it.
    expect(body.media?.projection).toBe('equirect');
    // The resource body must not carry the entry id (that's the URL param).
    expect(body).not.toHaveProperty('id');
  });

  it('preserves an operator-declared sensor across a rescan (the probe never reports it)', () => {
    const withSensor = {
      ...existing,
      capabilities: { ptz: true, sensors: ['bearing'] },
    } as unknown as ICameraEntry;
    const body = mergeRescan(withSensor, fresh);
    expect(body.capabilities?.sensors).toEqual(['bearing']); // survived the capability refresh
    expect(body.capabilities?.spotlight).toBe(true); // and the refreshed caps still applied
  });
});

describe('isStableSerial (identity hygiene)', () => {
  it('drops IP-shaped and empty serials so an address never persists as identity', () => {
    expect(isStableSerial('192.168.1.50')).toBe(false);
    expect(isStableSerial('')).toBe(false);
    expect(isStableSerial('fe80::abcd:1')).toBe(false);
  });

  it('keeps real serials and MAC addresses', () => {
    expect(isStableSerial('QSX1234567890')).toBe(true);
    expect(isStableSerial('aa:bb:cc:dd:ee:ff')).toBe(true);
  });
});

describe('draftFromHint (action-camera guided setup)', () => {
  const insta = {
    key: 'insta360-x',
    make: 'Insta360',
    models: ['X3', 'X4'],
    apHost: '192.168.42.1',
    steps: ['a', 'b'],
    sources: [
      {
        label: 'WiFi 360 preview (RTSP)',
        scheme: 'rtsp',
        host: '192.168.42.1',
        port: 8554,
        path: '/live',
        projection: 'equirectangular',
      },
    ],
    caveats: ['x'],
  };
  const gopro = {
    key: 'gopro-hero',
    make: 'GoPro',
    models: ['HERO13 Black'],
    apHost: '10.5.5.9',
    steps: ['a', 'b'],
    sources: [],
    caveats: ['x'],
  };

  it('pre-fills the hint source and carries the 360 projection into the resource body', () => {
    const draft = draftFromHint(insta, insta.sources[0]);
    expect(draft.source).toEqual({
      scheme: 'rtsp',
      host: '192.168.42.1',
      port: 8554,
      path: '/live',
    });
    expect(draft.media?.projection).toBe('equirectangular');
    const body = toResourceBody(draft);
    expect(body.media).toMatchObject({ projection: 'equirectangular' });
    expect(body.device).toMatchObject({ manufacturer: 'Insta360' });
  });

  it('starts a push-only device with an empty rtmp source and honest all-false capabilities', () => {
    const draft = draftFromHint(gopro, null);
    expect(draft.source).toEqual({ scheme: 'rtmp', host: '' });
    expect(draft.media).toBeUndefined();
    expect(Object.values(draft.capabilities).every((v) => v === false)).toBe(true);
    expect(draft.id).toBe('gopro');
    expect(draft.name).toBe('GoPro HERO13 Black');
  });
});

describe('parseStreamUrl (paste a stream URL)', () => {
  it('splits a full RTSP URL into the structured source', () => {
    expect(parseStreamUrl('rtsp://192.168.1.50:554/h264Preview_01_main')).toEqual({
      source: { scheme: 'rtsp', host: '192.168.1.50', port: 554, path: '/h264Preview_01_main' },
    });
  });

  it('STRIPS embedded credentials out of the URL — the resource never carries a secret', () => {
    const parsed = parseStreamUrl('rtsp://admin:s3cret%21@cam.local/stream1?subtype=0');
    expect(parsed).toEqual({
      source: { scheme: 'rtsp', host: 'cam.local', path: '/stream1?subtype=0' },
      username: 'admin',
      password: 's3cret!',
    });
  });

  it('handles rtmp/http(s) schemes, bare hosts, and IPv6', () => {
    expect(parseStreamUrl('rtmp://relay:1935/gopro')?.source).toEqual({
      scheme: 'rtmp',
      host: 'relay',
      port: 1935,
      path: '/gopro',
    });
    expect(parseStreamUrl('rtsp://cam.local')?.source).toEqual({
      scheme: 'rtsp',
      host: 'cam.local',
    });
    expect(parseStreamUrl('rtsp://[fe80::1]:554/s1')?.source).toEqual({
      scheme: 'rtsp',
      host: 'fe80::1',
      port: 554,
      path: '/s1',
    });
  });

  it('rejects non-stream schemes and junk', () => {
    expect(parseStreamUrl('file:///etc/passwd')).toBeNull();
    expect(parseStreamUrl('not a url')).toBeNull();
    expect(parseStreamUrl('192.168.1.50/stream')).toBeNull(); // no scheme -> make the user explicit
  });
});

describe('plainStreamDraft', () => {
  it('defaults id/name from the host with honestly all-false capabilities', () => {
    const draft = plainStreamDraft({ scheme: 'rtsp', host: '192.168.1.50', path: '/s1' });
    expect(draft.id).toBe('192-168-1-50');
    expect(draft.name).toBe('192.168.1.50');
    expect(Object.values(draft.capabilities).every((v) => v === false)).toBe(true);
    expect(draft.media).toBeUndefined();
  });
});

describe('streamSchemeHints (RTMP parity with RTSP)', () => {
  it('gives each scheme its conventional default port', () => {
    expect(streamSchemeHints('rtsp').defaultPort).toBe(554);
    expect(streamSchemeHints('rtsps').defaultPort).toBe(322);
    expect(streamSchemeHints('rtmp').defaultPort).toBe(1935);
    expect(streamSchemeHints('http').defaultPort).toBe(80);
    expect(streamSchemeHints('https').defaultPort).toBe(443);
  });

  it('gives a scheme-appropriate path + URL example', () => {
    // RTMP paths are app/streamKey, not the RTSP /stream1 shape.
    expect(streamSchemeHints('rtmp').pathPlaceholder).toMatch(/\/live\//);
    expect(streamSchemeHints('rtmp').urlExample).toMatch(/^rtmp:\/\//);
    expect(streamSchemeHints('rtsp').pathPlaceholder).toBe('/stream1');
    expect(streamSchemeHints('rtsp').urlExample).toMatch(/^rtsp:\/\//);
  });

  it('falls back safely for an unknown scheme', () => {
    expect(streamSchemeHints('gopher').defaultPort).toBeUndefined();
  });
});

describe('parseStreamUrl — RTMP', () => {
  it('parses an rtmp URL with an app/streamKey path', () => {
    const p = parseStreamUrl('rtmp://192.168.1.7:1935/live/boat');
    expect(p?.source).toEqual({
      scheme: 'rtmp',
      host: '192.168.1.7',
      port: 1935,
      path: '/live/boat',
    });
  });

  it('strips credentials embedded in an rtmp URL', () => {
    const p = parseStreamUrl('rtmp://streamer:secret@10.0.0.9/live/stream');
    expect(p?.source.scheme).toBe('rtmp');
    expect(p?.username).toBe('streamer');
    expect(p?.password).toBe('secret');
    expect(JSON.stringify(p?.source)).not.toContain('secret');
  });
});
