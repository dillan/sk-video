import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { registerEventLogRoutes, type IEventLogReader } from './event-log-routes';
import type { ILoggedEvent } from './event-log';

/** Capture the handler registered for GET /events/log so we can call it directly. */
function register(getReader: () => IEventLogReader | null) {
  let handler: ((req: Request, res: Response) => void) | undefined;
  const router = {
    get: (path: string, h: (req: Request, res: Response) => void) => {
      if (path === '/events/log') handler = h;
    },
  } as unknown as Parameters<typeof registerEventLogRoutes>[0];
  registerEventLogRoutes(router, getReader);
  if (!handler) throw new Error('route not registered');
  return handler;
}

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
  return res as Response & { statusCode: number; body: unknown };
}

const EVENTS: ILoggedEvent[] = [
  { id: 'e2', at: 2000, type: 'incident', state: 'alert', message: 'Incident captured' },
  { id: 'e1', at: 1000, type: 'mob', state: 'emergency', message: 'Person overboard' },
];

describe('event-log routes', () => {
  it('returns the newest-first event page', () => {
    const reader: IEventLogReader = { list: vi.fn(() => EVENTS) };
    const handler = register(() => reader);
    const res = makeRes();
    handler({ query: {} } as unknown as Request, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ events: EVENTS });
  });

  it('passes a parsed limit + before cursor through to the store', () => {
    const list = vi.fn(() => EVENTS);
    const handler = register(() => ({ list }));
    handler({ query: { limit: '50', before: '1500' } } as unknown as Request, makeRes());
    expect(list).toHaveBeenCalledWith({ limit: 50, before: 1500 });
  });

  it('ignores non-numeric limit/before rather than passing NaN', () => {
    const list = vi.fn(() => EVENTS);
    const handler = register(() => ({ list }));
    handler({ query: { limit: 'abc', before: 'xyz' } } as unknown as Request, makeRes());
    expect(list).toHaveBeenCalledWith({});
  });

  it('ignores a non-positive limit (a negative slice would drop the newest rows)', () => {
    const list = vi.fn(() => EVENTS);
    const handler = register(() => ({ list }));
    handler({ query: { limit: '-5' } } as unknown as Request, makeRes());
    expect(list).toHaveBeenCalledWith({});
  });

  it('503s before the plugin has started', () => {
    const handler = register(() => null);
    const res = makeRes();
    handler({ query: {} } as unknown as Request, res);
    expect(res.statusCode).toBe(503);
  });
});
