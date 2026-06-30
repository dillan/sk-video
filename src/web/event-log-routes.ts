import type { IRouter, Request, Response } from 'express';
import type { ILoggedEvent, IEventLogQuery } from './event-log';

/** The read surface of the event log (the bridge tap owns writes; this route only reads). */
export interface IEventLogReader {
  list(query?: IEventLogQuery): ILoggedEvent[];
}

/** Parse a finite-number query param, ignoring absent/non-numeric values. */
function numParam(value: unknown, opts: { positive?: boolean } = {}): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  // A negative/zero limit would hit slice(0, -n) and silently drop the newest rows — ignore it.
  if (opts.positive && n <= 0) return undefined;
  return n;
}

/**
 * `GET /plugins/sk-video/events/log` — the durable, newest-first activity feed (MOB, incidents,
 * anchor drag, camera-offline). Read-only and unauthenticated: rows carry only a type/state/message,
 * no secrets. `?limit=` bounds the page; `?before=<epoch-ms>` pages strictly-older events. This is
 * the retrospective record the live notification stream can't be — notifications vanish on clear.
 */
export function registerEventLogRoutes(
  router: IRouter,
  getReader: () => IEventLogReader | null,
): void {
  router.get('/events/log', (req: Request, res: Response) => {
    const reader = getReader();
    if (!reader) {
      res.status(503).json({ error: 'plugin not started' });
      return;
    }
    const query: IEventLogQuery = {};
    const limit = numParam(req.query.limit, { positive: true });
    if (limit !== undefined) query.limit = limit;
    const before = numParam(req.query.before);
    if (before !== undefined) query.before = before;
    res.json({ events: reader.list(query) });
  });
}
