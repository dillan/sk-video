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

/** A controllable timer harness: timers fire only when flush() is called; delays() exposes the pending
 * timers' requested delays so a test can tell a fast retry from a slow one. */
function fakeTimers() {
  let id = 0;
  const pending = new Map<number, { cb: () => void; ms: number }>();
  const setTimeoutImpl = ((cb: () => void, ms: number) => {
    const t = ++id;
    pending.set(t, { cb, ms });
    return { __id: t, unref() {} } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimeoutImpl = ((h: { __id: number }) => {
    if (h) pending.delete(h.__id);
  }) as typeof clearTimeout;
  const flush = (): void => {
    const entries = [...pending.values()];
    pending.clear();
    entries.forEach((e) => e.cb());
  };
  const delays = (): number[] => [...pending.values()].map((e) => e.ms);
  return { setTimeoutImpl, clearTimeoutImpl, flush, delays, size: () => pending.size };
}

const settle = () => new Promise((r) => setImmediate(r));

interface SetupOpts {
  onDegraded?: (n: number) => void;
  onHealthy?: () => void;
}

function setup(opts: SetupOpts = {}) {
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
    onDegraded: opts.onDegraded,
    onHealthy: opts.onHealthy,
    spawnImpl,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });
  return { proc, children, spawnImpl, logs, timers };
}

/** Crash the most recently spawned child and fire the resulting respawn backoff timer. */
async function crashAndRespawn(
  children: FakeChild[],
  timers: ReturnType<typeof fakeTimers>,
): Promise<void> {
  children[children.length - 1].exit(1);
  timers.flush();
  await settle();
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

  it('keeps retrying on a slower cadence (never gives up) after repeated crashes', async () => {
    const onDegraded = vi.fn();
    const { proc, children, spawnImpl, timers } = setup({ onDegraded });
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();

    // The first crash schedules a FAST respawn.
    children[children.length - 1].exit(1);
    const fastDelay = timers.delays()[0];
    timers.flush();
    await settle();

    // Crash through the fast budget and well past the old give-up cap.
    for (let i = 0; i < 8; i++) {
      await crashAndRespawn(children, timers);
    }
    // Old behaviour stopped at 6 spawns; now it keeps respawning.
    expect(spawnImpl.mock.calls.length).toBeGreaterThan(6);

    // The next respawn uses a SLOWER backoff than the initial fast one, and the gateway was flagged down.
    children[children.length - 1].exit(1);
    expect(timers.delays()[0]).toBeGreaterThan(fastDelay);
    expect(onDegraded).toHaveBeenCalled();
  });

  it('recovers: a stable run clears the degraded state and resumes fast retries', async () => {
    const onDegraded = vi.fn();
    const onHealthy = vi.fn();
    const { proc, children, timers } = setup({ onDegraded, onHealthy });
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();

    // Capture the fast delay, then drive into the degraded (slow-retry) state.
    children[children.length - 1].exit(1);
    const fastDelay = timers.delays()[0];
    timers.flush();
    await settle();
    for (let i = 0; i < 6; i++) {
      await crashAndRespawn(children, timers);
    }
    expect(onDegraded).toHaveBeenCalledTimes(1); // flagged down exactly once on entering slow retry

    // The latest child survives: firing its stable-run timer marks it healthy again.
    timers.flush();
    await settle();
    expect(onHealthy).toHaveBeenCalledTimes(1);

    // A subsequent crash is treated as fresh — fast retry, no second degraded flag.
    children[children.length - 1].exit(1);
    expect(timers.delays()[0]).toBe(fastDelay);
    expect(onDegraded).toHaveBeenCalledTimes(1);
  });

  it('does not flag the gateway down for a single crash within the fast budget', async () => {
    const onDegraded = vi.fn();
    const { proc, children, timers } = setup({ onDegraded });
    proc.start('/bin/go2rtc', '/cfg.yaml');
    await settle();
    await crashAndRespawn(children, timers); // one crash, fast respawn
    expect(onDegraded).not.toHaveBeenCalled();
  });
});
