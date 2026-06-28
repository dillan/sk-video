import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerCalibrationRoute, type ICalibrationContext } from './calibration-routes';
import type { ICamera } from '../cameras/camera-validation';

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const CAMERA: ICamera = {
  name: 'Mast PTZ',
  enabled: true,
  source: { scheme: 'onvif', host: 'cam.local', port: 80 },
  capabilities: { ptz: true, absolutePtz: true },
};

// Two distinct-angle samples per axis that solve to tidy coefficients (offset 0).
const SAMPLES = {
  pan: [
    { deg: -30, normalized: -0.5 },
    { deg: 30, normalized: 0.5 },
  ],
  tilt: [
    { deg: -10, normalized: -0.2 },
    { deg: 10, normalized: 0.2 },
  ],
};

function setup(overrides: Partial<ICalibrationContext> = {}) {
  const ctx: ICalibrationContext = {
    ready: () => true,
    getCamera: vi.fn(() => CAMERA),
    setCalibration: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  let captured!: (req: Request, res: Response) => unknown;
  const router = {
    post: (_p: string, h: (req: Request, res: Response) => unknown) => {
      captured = h;
    },
  } as unknown as IRouter;
  registerCalibrationRoute(router, ctx);
  const call = async (body: unknown, id = 'mast') => {
    const res = makeRes();
    await captured({ body, params: { id } } as unknown as Request, res);
    return res;
  };
  return { ctx, call };
}

describe('registerCalibrationRoute', () => {
  it('returns 503 before the plugin has started', async () => {
    const { call } = setup({ ready: () => false });
    const res = await call(SAMPLES);
    expect(res.statusCode).toBe(503);
  });

  it('returns 404 for an unknown camera', async () => {
    const { ctx, call } = setup({ getCamera: () => null });
    const res = await call(SAMPLES);
    expect(res.statusCode).toBe(404);
    expect(ctx.setCalibration).not.toHaveBeenCalled();
  });

  it('solves and persists the calibration, echoing it back', async () => {
    const { ctx, call } = setup();
    const res = await call(SAMPLES);
    expect(res.statusCode).toBe(200);
    const calibration = {
      pan: { offset: 0, scalePerDeg: 1 / 60 },
      tilt: { offset: 0, scalePerDeg: 0.02 },
    };
    expect((res.body as { calibration: unknown }).calibration).toEqual(calibration);
    expect(ctx.setCalibration).toHaveBeenCalledWith('mast', calibration);
  });

  it('rejects malformed samples with 400 and never persists', async () => {
    const { ctx, call } = setup();
    const res = await call({ pan: [{ deg: 0, normalized: 0 }], tilt: SAMPLES.tilt }); // only one pan sample
    expect(res.statusCode).toBe(400);
    expect(ctx.setCalibration).not.toHaveBeenCalled();
  });

  it('rejects two same-angle samples with 400 (a point cannot define a line)', async () => {
    const { call } = setup();
    const res = await call({
      pan: [
        { deg: 10, normalized: 0.1 },
        { deg: 10, normalized: 0.2 },
      ],
      tilt: SAMPLES.tilt,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when persistence fails', async () => {
    const { call } = setup({
      setCalibration: vi.fn().mockRejectedValue(new Error('disk full')),
    });
    const res = await call(SAMPLES);
    expect(res.statusCode).toBe(500);
  });
});
