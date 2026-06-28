import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Go2rtcProcess } from './go2rtc-process';

/** A fake go2rtc child: separate stdout/stderr emitters and a recorded kill log. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: string[] = [];
  kill(signal: string): boolean {
    this.killed.push(signal);
    return true;
  }
  exit(code = 0): void {
    this.emit('exit', code);
  }
}

/** A controllable timer harness: timers fire only when flush() is called. */
function fakeTimers() {
  let id = 0;
  const pending = new Map<number, () => void>();
  const setTimeoutImpl = ((cb: () => void) => {
    const t = ++id;
    pending.set(t, cb);
    return { __id: t, unref() {} } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimeoutImpl = ((h: { __id: number }) => {
    if (h) pending.delete(h.__id);
  }) as typeof clearTimeout;
  const flush = (): void => {
    const cbs = [...pending.values()];
    pending.clear();
    cbs.forEach((cb) => cb());
  };
  return { setTimeoutImpl, clearTimeoutImpl, flush, size: () => pending.size };
}

const settle = () => new Promise((r) => setImmediate(r));

function setup() {
  const children: FakeChild[] = [];
  const spawnImpl = vi.fn(() => {
    const c = new FakeChild();
    children.push(c);
    return c as never;
  });
  const logs: string[] = [];
  const timers = fakeTimers();
  const proc = new Go2rtcProcess({
    log: (m) => logs.push(m),
    spawnImpl,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });
  return { proc, children, spawnImpl, logs, timers };
}

describe('Go2rtcProcess', () => {
  it('spawns go2rtc with the config and drains BOTH stdout and stderr', async () => {
    const { proc, children, spawnImpl, logs } = setup();
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();
    expect(spawnImpl).toHaveBeenCalledWith(
      '/bin/go2rtc',
      ['-config', '/cfg.yaml'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    expect(proc.running).toBe(true);
    children[0].stdout.emit('data', Buffer.from('hello-out'));
    children[0].stderr.emit('data', Buffer.from('hello-err'));
    expect(logs.some((l) => l.includes('hello-out'))).toBe(true);
    expect(logs.some((l) => l.includes('hello-err'))).toBe(true);
  });

  it('stops by terminating the child and resolves once it exits', async () => {
    const { proc, children } = setup();
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();
    const stopped = proc.stop();
    await settle(); // let the queued doStop run (detach + SIGTERM)
    expect(children[0].killed).toContain('SIGTERM');
    children[0].exit(0);
    await stopped;
    expect(proc.running).toBe(false);
  });

  it('restart kills the old child then spawns a new one', async () => {
    const { proc, children, spawnImpl } = setup();
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();
    proc.restart('/bin/go2rtc', '/cfg2.yaml');
    await settle(); // doStop detaches + SIGTERMs the old child
    children[0].exit(0); // it exits in response
    await settle(); // doStop resolves -> the new child is spawned
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(children[1]).toBeDefined();
  });

  it('a teardown stop racing an in-flight restart never orphans a new child', async () => {
    const { proc, children, spawnImpl } = setup();
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle(); // child A running
    proc.restart('/bin/go2rtc', '/cfg.yaml'); // queue: stop(A) -> start(B)
    const stopped = proc.stop(); // closed=true synchronously -> the queued start(B) must NOT spawn
    children[0].exit(0); // A finishes terminating
    await stopped;
    expect(spawnImpl).toHaveBeenCalledTimes(1); // B was never spawned
    expect(proc.running).toBe(false);
  });

  it('auto-restarts after an unexpected crash (capped backoff)', async () => {
    const { proc, children, spawnImpl, timers } = setup();
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();
    children[0].exit(1); // unexpected crash while we wanted it running
    expect(proc.running).toBe(false);
    timers.flush(); // fire the respawn backoff timer
    await settle();
    expect(spawnImpl).toHaveBeenCalledTimes(2); // respawned
  });

  it('does NOT auto-restart after a deliberate stop', async () => {
    const { proc, children, spawnImpl, timers } = setup();
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();
    const stopped = proc.stop();
    children[0].exit(0);
    await stopped;
    timers.flush();
    await settle();
    expect(spawnImpl).toHaveBeenCalledTimes(1); // no respawn after an intentional stop
  });

  it('gives up auto-restarting after repeated crashes', async () => {
    const { proc, children, spawnImpl, timers } = setup();
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();
    // Crash-and-respawn repeatedly; after the cap it stops trying.
    for (let i = 0; i < 8; i++) {
      children[children.length - 1].exit(1);
      timers.flush();
      await settle();
    }
    expect(spawnImpl.mock.calls.length).toBeLessThanOrEqual(6); // initial + at most 5 restarts
  });
});
