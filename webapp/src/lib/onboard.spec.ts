import { describe, it, expect } from 'vitest';
import {
  isOnvifCandidate,
  rankCandidates,
  slugify,
  isValidSlug,
  draftFromIntrospect,
  toResourceBody,
} from './onboard';
import type { ICandidate, IIntrospectResult } from '../api';

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
    });
    expect(d.media).toBeUndefined(); // this fixture carries no codec/substream
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

  it('drops an unsafe substream path (query string) so the camera still saves', () => {
    const d = draftFromIntrospect(
      { ...result, codec: 'h265', substreamPath: '/sub?token=abc', substreams: true },
      'cam',
    );
    // The path can't pass the resource validator, so we don't claim a substream at all.
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
      },
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
});
