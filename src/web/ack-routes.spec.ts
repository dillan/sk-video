import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerAckRoutes } from './ack-routes';

function harness(over: { ack?: (key: string) => boolean; gated?: boolean } = {}) {
  let handler: ((req: Request, res: Response) => unknown) | null = null;
  const router = {
    post: (_path: string, h: (req: Request, res: Response) => unknown) => (handler = h),
  } as unknown as IRouter;
  const ack = vi.fn(over.ack ?? (() => true));
  registerAckRoutes(router, {
    ack,
    gate: (_req, res) => {
      if (over.gated) {
        res.status(401).json({ error: 'unauthorized' });
        return true;
      }
      return false;
    },
  });
  const call = (body: unknown) => {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      ended: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
      end() {
        this.ended = true;
        return this;
      },
    };
    handler!({ body } as Request, res as unknown as Response);
    return res;
  };
  return { call, ack };
}

describe('POST /notifications/ack', () => {
  it('acks an active key shared-state and returns 204', () => {
    const { call, ack } = harness();
    const res = call({ key: 'mob' });
    expect(res.statusCode).toBe(204);
    expect(ack).toHaveBeenCalledWith('mob');
  });

  it('404s a key with nothing raised under it', () => {
    const { call } = harness({ ack: () => false });
    expect(call({ key: 'ghost' }).statusCode).toBe(404);
  });

  it('rejects malformed keys before touching the bridge', () => {
    const { call, ack } = harness();
    // (A numeric body stringifies to a valid key shape and simply 404s at the bridge.)
    for (const key of ['', '../evil', 'a b', 'x'.repeat(80), undefined]) {
      expect(call({ key }).statusCode).toBe(400);
    }
    expect(ack).not.toHaveBeenCalled();
  });

  it('is auth-gated (acking is a write to shared safety state)', () => {
    const { call, ack } = harness({ gated: true });
    expect(call({ key: 'mob' }).statusCode).toBe(401);
    expect(ack).not.toHaveBeenCalled();
  });
});
