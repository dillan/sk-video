import { spawn, type ChildProcess } from 'node:child_process';
import type { IProcessController } from './go2rtc-gateway';

/**
 * Supervises the go2rtc child process. Restart re-spawns with the new config (the simplest reliable
 * reload). Stop terminates the child and resolves once it has exited, escalating to SIGKILL if it
 * does not exit promptly so ports are always freed.
 */
export class Go2rtcProcess implements IProcessController {
  private child: ChildProcess | null = null;

  constructor(private readonly log: (msg: string) => void = () => undefined) {}

  get running(): boolean {
    return this.child !== null;
  }

  start(binaryPath: string, configPath: string): void {
    if (this.child) {
      return;
    }
    const child = spawn(binaryPath, ['-config', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    child.stderr?.on('data', (d: Buffer) => this.log(`go2rtc: ${d.toString().trim()}`));
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = null;
      }
      this.log(`go2rtc exited (code ${code})`);
    });
    child.on('error', (err) => {
      if (this.child === child) {
        this.child = null;
      }
      this.log(`go2rtc failed to start: ${err.message}`);
    });
  }

  restart(binaryPath: string, configPath: string): void {
    void this.stop().then(() => this.start(binaryPath, configPath));
  }

  stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      child.once('exit', finish);
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        finish();
      }, 3000);
    });
  }
}
