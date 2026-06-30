import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { IProcessController } from './go2rtc-gateway';

/**
 * Supervises the go2rtc child process. All start/restart/stop work is serialized through one promise
 * chain and gated by a `closed` flag, so an in-flight restart can never outlive a teardown and orphan a
 * go2rtc still bound to the loopback ports. An unexpected exit (a crash) auto-restarts — fast for the
 * first few attempts, then on a slow self-healing cadence (never giving up, so a transient boot-time
 * port conflict recovers without a config change) — while a deliberate stop/restart does not. Crossing
 * into slow retries flags the gateway down (onDegraded) so the plugin status reflects it; a stable run
 * clears it (onHealthy). Both stdio pipes are drained — an unconsumed stdout pipe fills over long
 * uptime and deadlocks go2rtc.
 */

const KILL_TIMEOUT_MS = 3000;
const CRASH_RESTART_DELAY_MS = 2000;
const MAX_CRASH_RESTARTS = 5; // fast retries for a one-off crash before backing off to a slow cadence
// After the fast budget we keep retrying on this slower cadence rather than giving up — a transient
// boot-time failure (e.g. a port still held by a prior instance) must self-heal without a config change.
const SLOW_RESTART_DELAY_MS = 30_000;
const STABLE_RUN_MS = 30_000; // a child that survives this long is considered healthy; reset the counter

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type SetTimeoutFn = (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
type ClearTimeoutFn = (token: ReturnType<typeof setTimeout>) => void;

export interface IGo2rtcProcessOptions {
  log?: (msg: string) => void;
  /** Called once when go2rtc has crashed past the fast-retry budget and is now on slow retries — so the
   * plugin can surface a "video gateway down" status instead of leaving a stale "Ready". */
  onDegraded?: (attempts: number) => void;
  /** Called when go2rtc recovers (runs stably) after having been degraded — to clear that status. */
  onHealthy?: () => void;
  /** Injectable spawn/timers for testing. */
  spawnImpl?: SpawnFn;
  setTimeoutImpl?: SetTimeoutFn;
  clearTimeoutImpl?: ClearTimeoutFn;
}

export class Go2rtcProcess implements IProcessController {
  private child: ChildProcess | null = null;
  private closed = false; // set by stop(); blocks any further spawn (incl. a queued restart/respawn)
  private wantRunning = false; // true while we intend a child to be running (drives crash auto-restart)
  private pending: Promise<void> = Promise.resolve(); // serializes all start/restart/stop operations
  private crashRestarts = 0;
  private degraded = false; // true while go2rtc is failing past the fast-retry budget (status is "down")
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private last: { binaryPath: string; configPath: string } | null = null;

  private readonly log: (msg: string) => void;
  private readonly onDegraded: (attempts: number) => void;
  private readonly onHealthy: () => void;
  private readonly spawnImpl: SpawnFn;
  private readonly setTimeoutImpl: SetTimeoutFn;
  private readonly clearTimeoutImpl: ClearTimeoutFn;

  constructor(options: IGo2rtcProcessOptions | ((msg: string) => void) = {}) {
    const opts: IGo2rtcProcessOptions = typeof options === 'function' ? { log: options } : options;
    this.log = opts.log ?? (() => undefined);
    this.onDegraded = opts.onDegraded ?? (() => undefined);
    this.onHealthy = opts.onHealthy ?? (() => undefined);
    this.spawnImpl = opts.spawnImpl ?? (nodeSpawn as SpawnFn);
    this.setTimeoutImpl = opts.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = opts.clearTimeoutImpl ?? clearTimeout;
  }

  get running(): boolean {
    return this.child !== null;
  }

  start(binaryPath: string, configPath: string): void {
    void this.enqueue(() => this.doStart(binaryPath, configPath));
  }

  restart(binaryPath: string, configPath: string): void {
    void this.enqueue(async () => {
      await this.doStop();
      this.doStart(binaryPath, configPath);
    });
  }

  stop(): Promise<void> {
    // Terminal: block any queued/future spawn synchronously, then await the whole chain so a restart
    // that was already in flight is killed rather than left orphaned on the ports.
    this.closed = true;
    this.clearTimers();
    return this.enqueue(() => this.doStop());
  }

  /** Chain an operation after the previous one, running it even if a prior op rejected. */
  private enqueue(op: () => void | Promise<void>): Promise<void> {
    this.pending = this.pending.then(op, op);
    return this.pending;
  }

  private doStart(binaryPath: string, configPath: string): void {
    if (this.closed || this.child) {
      return; // torn down, or already running
    }
    this.last = { binaryPath, configPath };
    const child = this.spawnImpl(binaryPath, ['-config', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.wantRunning = true;
    // Drain AND log BOTH pipes: go2rtc logs to stdout, and an unconsumed stdout pipe fills (~64 KB) and
    // blocks the child's write(), deadlocking go2rtc over days of uptime on a flaky link.
    child.stdout?.on('data', (d: Buffer) => this.log(`go2rtc: ${d.toString().trim()}`));
    child.stderr?.on('data', (d: Buffer) => this.log(`go2rtc: ${d.toString().trim()}`));
    this.stableTimer = this.setTimeoutImpl(() => {
      this.crashRestarts = 0; // it has run long enough to be considered healthy
      if (this.degraded) {
        this.degraded = false;
        this.onHealthy(); // recovered after being down — let the plugin clear the "gateway down" status
      }
    }, STABLE_RUN_MS);
    this.stableTimer.unref?.();
    child.on('exit', (code) => this.onChildExit(child, `code ${String(code)}`));
    child.on('error', (err) => this.onChildExit(child, `error ${err.message}`));
  }

  private onChildExit(child: ChildProcess, why: string): void {
    if (this.child !== child) {
      return; // a deliberate stop already detached this child (or it was replaced)
    }
    this.child = null;
    if (this.stableTimer) {
      this.clearTimeoutImpl(this.stableTimer);
      this.stableTimer = null;
    }
    this.log(`go2rtc exited (${why})`);
    if (!this.wantRunning || this.closed) {
      return; // expected stop/restart — do not auto-restart
    }
    this.crashRestarts += 1;
    // Never give up permanently. The first few crashes retry fast (a one-off blip); past that budget we
    // keep retrying on a slow cadence so a transient boot-time failure self-heals without a config
    // change — and we flag the gateway as down so the status stops claiming "Ready". A later stable run
    // resets back to fast retries and clears the down state.
    const fast = this.crashRestarts <= MAX_CRASH_RESTARTS;
    const delay = fast ? CRASH_RESTART_DELAY_MS : SLOW_RESTART_DELAY_MS;
    if (!fast && !this.degraded) {
      this.degraded = true;
      this.log(
        `go2rtc crashed ${this.crashRestarts}x; backing off to a slow retry every ${SLOW_RESTART_DELAY_MS / 1000}s`,
      );
      this.onDegraded(this.crashRestarts);
    }
    const last = this.last;
    this.respawnTimer = this.setTimeoutImpl(() => {
      this.respawnTimer = null;
      if (this.closed || !last) {
        return;
      }
      this.log(
        `auto-restarting go2rtc (attempt ${this.crashRestarts}${fast ? '' : ', slow retry'})`,
      );
      void this.enqueue(() => this.doStart(last.binaryPath, last.configPath));
    }, delay);
    this.respawnTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.respawnTimer) {
      this.clearTimeoutImpl(this.respawnTimer);
      this.respawnTimer = null;
    }
    if (this.stableTimer) {
      this.clearTimeoutImpl(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private doStop(): Promise<void> {
    this.wantRunning = false;
    this.clearTimers();
    const child = this.child;
    this.child = null; // detach first so the exit handler treats this as a deliberate stop
    if (!child) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      child.once('exit', finish);
      try {
        child.kill('SIGTERM');
      } catch {
        finish();
        return;
      }
      const timer = this.setTimeoutImpl(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        finish();
      }, KILL_TIMEOUT_MS);
      timer.unref?.();
    });
  }
}
