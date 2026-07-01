import { describe, it, expect } from 'vitest';
import {
  cameraSubtitle,
  tileStatus,
  tileCategory,
  summarizeCategories,
  capabilityBadges,
} from './camera';
import type { ICamera } from '../api';

const base: ICamera = { name: 'Bow', enabled: true };

describe('capabilityBadges', () => {
  const cam = (capabilities: ICamera['capabilities']): ICamera => ({ ...base, capabilities });

  it('surfaces each supported capability from discovery as a badge', () => {
    const labels = capabilityBadges(
      cam({
        absolutePtz: true,
        audio: true,
        audioBackchannel: true,
        substreams: true,
        spotlight: true,
        alarm: true,
        imaging: ['irCut'],
      }),
    ).map((b) => b.label);
    expect(labels).toEqual([
      'PTZ',
      'Imaging',
      'Audio',
      'Two-way',
      'H.264 sub',
      'Spotlight',
      'Alarm',
    ]);
  });

  it('shows nothing for a plain camera with no reported capabilities (no "unsupported" chips)', () => {
    expect(capabilityBadges(cam({}))).toEqual([]);
    expect(capabilityBadges(base)).toEqual([]);
  });

  it('labels PTZ by whether absolute pointing was detected', () => {
    expect(capabilityBadges(cam({ ptz: true }))[0].title).toMatch(/Pan\/tilt\/zoom/);
    expect(capabilityBadges(cam({ absolutePtz: true }))[0].title).toMatch(/absolute/);
  });
});

describe('tileCategory', () => {
  it('classifies live, still-refresh, reconnecting, and offline', () => {
    expect(tileCategory(base, true, false, 'webrtc')).toBe('live');
    expect(tileCategory(base, true, false, 'mjpeg')).toBe('stillRefresh');
    expect(tileCategory(base, false, false, 'mjpeg')).toBe('reconnecting');
    expect(tileCategory(base, false, true, 'mjpeg')).toBe('offline'); // dead feed
    expect(tileCategory({ ...base, enabled: false }, false, false, 'mjpeg')).toBe('offline');
  });
});

describe('summarizeCategories', () => {
  it('builds the header tally, omitting zero buckets', () => {
    expect(summarizeCategories(['live', 'live', 'stillRefresh', 'reconnecting', 'offline'])).toBe(
      '2 live · 1 still-refresh · 1 reconnecting · 1 offline',
    );
    expect(summarizeCategories(['live'])).toBe('1 live');
    expect(summarizeCategories([])).toBe('');
  });
});

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
