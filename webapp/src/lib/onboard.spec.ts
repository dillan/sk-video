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
    });
  });
  it('falls back to the host when make/model are absent', () => {
    expect(
      draftFromIntrospect({ ...result, manufacturer: undefined, model: undefined }, 'cam').name,
    ).toBe('cam');
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
      capabilities: { ptz: true, absolutePtz: true, audio: true, audioBackchannel: true },
      role: 'security',
      placement: { mount: 'mast', bearingRelativeDeg: 90 },
    });
  });
  it('omits placement entirely when neither mount nor bearing is set', () => {
    const body = toResourceBody(draftFromIntrospect(result, '192.168.1.100'));
    expect(body.placement).toBeUndefined();
    expect(body.role).toBeUndefined();
  });
});
