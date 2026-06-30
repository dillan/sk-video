import { join } from 'node:path';
import { concatListContent, clipArgs, type IClipPlan } from './incident-clip';

/**
 * Thin, fully-injected ffmpeg seam for cutting a clip. It writes the concat list to an injected tmp
 * dir, spawns ffmpeg (injected, the RecordingManager convention), resolves on a clean exit by reading
 * the output bytes, and always cleans up its temp files. Because every bare spawn/fs call is injected,
 * the orchestration is unit-testable with a fake spawn — no coverage exclusion required.
 */

export interface IClipChild {
  on(event: 'close', cb: (code: number | null) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
}

export interface IClipProducerDeps {
  spawn: (args: string[]) => IClipChild;
  writeFile: (path: string, data: string) => void;
  readFile: (path: string) => Promise<Uint8Array>;
  removeFile: (path: string) => void;
  tmpDir: () => string;
  idGen?: () => string;
}

export type ClipProducer = (plan: IClipPlan) => Promise<{ ok: boolean; bytes?: Uint8Array }>;

export function createFfmpegClipProducer(deps: IClipProducerDeps): ClipProducer {
  let counter = 0;
  const nextId = deps.idGen ?? (() => `clip-${(counter += 1)}`);

  return (plan) => {
    const id = nextId();
    const listPath = join(deps.tmpDir(), `${id}.txt`);
    const outPath = join(deps.tmpDir(), `${id}.mp4`);
    const cleanup = (): void => {
      try {
        deps.removeFile(listPath);
      } catch {
        /* best effort */
      }
      try {
        deps.removeFile(outPath);
      } catch {
        /* best effort */
      }
    };

    return new Promise((resolve) => {
      let settled = false;
      const done = (result: { ok: boolean; bytes?: Uint8Array }): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };

      try {
        deps.writeFile(listPath, concatListContent(plan.inputs));
      } catch {
        done({ ok: false });
        return;
      }

      const child = deps.spawn(clipArgs(listPath, plan, outPath));
      child.on('error', () => done({ ok: false }));
      child.on('close', (code) => {
        if (code !== 0) {
          done({ ok: false });
          return;
        }
        deps
          .readFile(outPath)
          .then((bytes) => done({ ok: true, bytes }))
          .catch(() => done({ ok: false }));
      });
    });
  };
}
