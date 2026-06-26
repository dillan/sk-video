import { describe, it, expect, vi, afterEach } from 'vitest';
import { OnvifPtzController, type IOnvifCam } from './onvif-controller';

class FakeCam implements IOnvifCam {
  moves: { x: number; y: number; zoom: number }[] = [];
  stops = 0;
  gotos: string[] = [];
  presets: Record<string, string> = { Preset1: 'token-1' };
  failContinuous = false;

  continuousMove(o: { x: number; y: number; zoom: number }, cb: (err?: Error | null) => void) {
    this.moves.push(o);
    cb(this.failContinuous ? new Error('camera offline') : null);
  }
  stop(_o: { panTilt?: boolean; zoom?: boolean }, cb: (err?: Error | null) => void) {
    this.stops++;
    cb(null);
  }
  getPresets(cb: (err: Error | null, presets?: Record<string, string>) => void) {
    cb(null, this.presets);
  }
  gotoPreset(o: { preset: string }, cb: (err?: Error | null) => void) {
    this.gotos.push(o.preset);
    cb(null);
  }
}

afterEach(() => vi.useRealTimers());

describe('OnvifPtzController', () => {
  it('clamps the velocity and issues a continuous move', async () => {
    const cam = new FakeCam();
    await new OnvifPtzController(async () => cam).move({ pan: 5, tilt: -0.5, zoom: 9 });
    expect(cam.moves).toEqual([{ x: 1, y: -0.5, zoom: 1 }]);
  });

  it('stops motion', async () => {
    const cam = new FakeCam();
    await new OnvifPtzController(async () => cam).stop();
    expect(cam.stops).toBe(1);
  });

  it('propagates a camera error from a move', async () => {
    const cam = new FakeCam();
    cam.failContinuous = true;
    await expect(new OnvifPtzController(async () => cam).move({ pan: 1 })).rejects.toThrow(/offline/);
  });

  it('rejects an invalid preset token before contacting the camera', async () => {
    const cam = new FakeCam();
    await expect(new OnvifPtzController(async () => cam).gotoPreset('<bad>')).rejects.toThrow();
    expect(cam.gotos).toEqual([]);
  });

  it('goes to a valid preset and lists presets', async () => {
    const cam = new FakeCam();
    const c = new OnvifPtzController(async () => cam);
    await c.gotoPreset('token-1');
    expect(cam.gotos).toEqual(['token-1']);
    expect(await c.getPresets()).toEqual({ Preset1: 'token-1' });
  });

  it('auto-stops a continuous move after the timeout', async () => {
    vi.useFakeTimers();
    const cam = new FakeCam();
    const c = new OnvifPtzController(async () => cam, { autoStopMs: 1500 });
    await c.move({ pan: 1 });
    expect(cam.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(cam.stops).toBe(1);
  });
});
