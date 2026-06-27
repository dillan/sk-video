import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import type { IFfprobeOutcome, TFfprobeRunner, TTcpProbe } from './probe';

/**
 * Runs the real `ffprobe` binary. Spawned via execFile with an argument vector (no shell), so the
 * source URL can never be interpreted as a command. Resolves with the outcome; rejects only if the
 * binary can't be spawned (e.g. ffmpeg not installed), which the route turns into a friendly message.
 */
export const runFfprobe: TFfprobeRunner = (args, timeoutMs) =>
  new Promise<IFfprobeOutcome>((resolve, reject) => {
    execFile(
      'ffprobe',
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
        if (e && (e.code === 'ENOENT' || e.code === 'EACCES')) {
          reject(e); // binary not found — let the route report "is ffmpeg installed?"
          return;
        }
        resolve({
          code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
          timedOut: !!e?.killed,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });

/** Opens a TCP connection to verify a host:port answers (used for ONVIF, which ffprobe can't read). */
export const tcpProbe: TTcpProbe = (host, port, timeoutMs) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
