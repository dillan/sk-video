import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventLog,
  FileEventLogPersistence,
  type IEventLogOptions,
  type IEventLogPersistence,
  type ILoggedEvent,
} from './event-log';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sk-events-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** In-memory persistence so the store logic is tested without touching disk. */
function memPersistence(
  seed: ILoggedEvent[] = [],
): IEventLogPersistence & { saved: ILoggedEvent[] } {
  const box = { saved: [...seed] };
  return {
    saved: box.saved,
    load: () => [...box.saved],
    save: (events) => {
      box.saved.length = 0;
      box.saved.push(...events);
    },
  };
}

function makeLog(over: Partial<IEventLogOptions> = {}) {
  let t = 1000;
  let n = 0;
  const persistence = memPersistence();
  const log = new EventLog({
    persistence,
    now: () => (t += 10),
    idGen: () => `ev-${++n}`,
    ...over,
  });
  return { log, persistence };
}

describe('EventLog', () => {
  it('appends events, stamping an id + time, and lists them newest-first', () => {
    const { log } = makeLog();
    log.append({ type: 'mob', state: 'emergency', message: 'Person overboard' });
    log.append({ type: 'incident', state: 'alert', message: 'Incident captured' });

    const events = log.list();
    expect(events.map((e) => e.type)).toEqual(['incident', 'mob']); // newest first
    expect(events[0].id).toBeTruthy();
    expect(events[0].at).toBeGreaterThan(events[1].at);
  });

  it('persists each append so a fresh store reloads the history', () => {
    const { log, persistence } = makeLog();
    log.append({ type: 'anchor.drag', state: 'alarm' });
    expect(persistence.saved).toHaveLength(1);

    const reloaded = new EventLog({ persistence });
    expect(reloaded.list().map((e) => e.type)).toEqual(['anchor.drag']);
  });

  it('bounds growth, dropping the oldest events past maxCount', () => {
    const { log } = makeLog({ maxCount: 3 });
    for (const type of ['a', 'b', 'c', 'd', 'e']) log.append({ type });
    expect(log.list().map((e) => e.type)).toEqual(['e', 'd', 'c']); // oldest a,b pruned
  });

  it('honors a limit and a before-cursor for paging older events', () => {
    const { log } = makeLog();
    for (const type of ['a', 'b', 'c', 'd']) log.append({ type }); // at = 1010,1020,1030,1040
    const firstPage = log.list({ limit: 2 });
    expect(firstPage.map((e) => e.type)).toEqual(['d', 'c']);
    const older = log.list({ limit: 2, before: firstPage[firstPage.length - 1].at });
    expect(older.map((e) => e.type)).toEqual(['b', 'a']); // strictly older than c
  });
});

describe('FileEventLogPersistence', () => {
  it('round-trips events through an owner-only JSON file', () => {
    const dir = tmp();
    const p = new FileEventLogPersistence(dir);
    expect(p.load()).toEqual([]); // no file yet → empty
    const events: ILoggedEvent[] = [{ id: 'e1', at: 1, type: 'mob', state: 'emergency' }];
    p.save(events);
    expect(existsSync(join(dir, 'events.json'))).toBe(true);
    expect((statSync(join(dir, 'events.json')).mode & 0o777).toString(8)).toBe('600');
    expect(new FileEventLogPersistence(dir).load()).toEqual(events);
  });

  it('starts fresh instead of throwing on a corrupt log file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'events.json'), 'not json{');
    expect(new FileEventLogPersistence(dir).load()).toEqual([]);
  });

  it('ignores a non-array JSON payload', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'events.json'), '{"events":1}');
    expect(new FileEventLogPersistence(dir).load()).toEqual([]);
  });
});
