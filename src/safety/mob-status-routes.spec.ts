import { describe, it, expect } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerMobStatusRoute } from './mob-status-routes';
import type { IMobStatus } from './mob-controller';

function harness(status: IMobStatus | null, refine = { enabled: false, active: false }) {
  let handler: ((req: Request, res: Response) => unknown) | null = null;
  const router = {
    get: (_path: string, h: (req: Request, res: Response) => unknown) => (handler = h),
  } as unknown as IRouter;
  registerMobStatusRoute(router, { status: () => status, visualRefine: () => refine });
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
  handler!({} as Request, res as unknown as Response);
  return res;
}

const IDLE: IMobStatus = {
  active: false,
  targetSource: 'none',
  aimedCameras: 0,
  capableCameras: 1,
  aimedCameraIds: [],
  cameraAims: [],
  armedAt: null,
  lastReaimAt: null,
};

describe('GET /mob (read-only status)', () => {
  it('returns the controller status with the visual-refine posture attached', () => {
    const res = harness(IDLE, { enabled: true, active: false });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      active: false,
      capableCameras: 1,
      visualRefine: { enabled: true, active: false },
    });
  });

  it('503s before the plugin has started', () => {
    const res = harness(null);
    expect(res.statusCode).toBe(503);
  });
});
