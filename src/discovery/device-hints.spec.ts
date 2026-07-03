import { describe, it, expect } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { deviceHints, deviceHint, registerOnboardingHintsRoute } from './device-hints';
import { CAMERA_SCHEMES, CAMERA_PROJECTIONS } from '../cameras/camera-validation';

describe('deviceHints', () => {
  it('exposes Insta360 and GoPro presets', () => {
    const keys = deviceHints().map((h) => h.key);
    expect(keys).toContain('insta360-x');
    expect(keys).toContain('gopro-hero');
  });

  it('every source uses an allow-listed scheme and a recognised projection', () => {
    for (const hint of deviceHints()) {
      for (const src of hint.sources) {
        expect((CAMERA_SCHEMES as readonly string[]).includes(src.scheme)).toBe(true);
        if (src.projection) {
          expect((CAMERA_PROJECTIONS as readonly string[]).includes(src.projection)).toBe(true);
        }
      }
    }
  });

  it('the Insta360 hint offers an equirectangular RTSP source (ties A2 + A3)', () => {
    const insta = deviceHint('insta360-x');
    expect(insta?.sources[0]).toMatchObject({ scheme: 'rtsp', projection: 'equirectangular' });
  });

  it('the GoPro hint has no pull source but explains the push model honestly', () => {
    const gopro = deviceHint('gopro-hero');
    expect(gopro?.sources).toEqual([]);
    expect(gopro?.caveats.join(' ')).toMatch(/RTMP|opportunistic/i);
  });

  it('every hint carries honest caveats, and returns defensive copies', () => {
    const hints = deviceHints();
    expect(hints.every((h) => h.caveats.length > 0)).toBe(true);
    hints[0].caveats.push('mutated'); // mutate the copy
    expect(deviceHints()[0].caveats).not.toContain('mutated'); // the source is untouched
  });

  it('every hint carries a numbered wizard walkthrough, defensively copied', () => {
    for (const hint of deviceHints()) {
      expect(hint.steps.length, `${hint.key} has no walkthrough`).toBeGreaterThanOrEqual(3);
      for (const step of hint.steps) {
        expect(step.length).toBeGreaterThan(10);
      }
    }
    // The GoPro walkthrough must teach the push model (there is nothing to pull directly).
    const gopro = deviceHint('gopro-hero')!;
    expect(gopro.steps.join(' ')).toMatch(/rtmp/i);
    // The Insta360 walkthrough must say the SERVER joins the camera's AP (not the phone/browser).
    const insta = deviceHint('insta360-x')!;
    expect(insta.steps.join(' ')).toMatch(/server/i);
    // Defensive copies: mutating a returned hint never leaks into the next read.
    insta.steps[0] = 'mutated';
    expect(deviceHint('insta360-x')!.steps[0]).not.toBe('mutated');
  });

  it('returns null for an unknown key', () => {
    expect(deviceHint('nope')).toBeNull();
  });
});

describe('registerOnboardingHintsRoute', () => {
  it('serves the hints', () => {
    let handler: ((req: Request, res: Response) => void) | undefined;
    const router = {
      get: (_p: string, h: (req: Request, res: Response) => void) => (handler = h),
    } as unknown as IRouter;
    registerOnboardingHintsRoute(router);
    let body: unknown;
    handler!({} as Request, { json: (b: unknown) => (body = b) } as unknown as Response);
    expect((body as { hints: unknown[] }).hints.length).toBeGreaterThanOrEqual(2);
  });
});
