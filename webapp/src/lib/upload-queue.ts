/**
 * Sequential multi-file upload queue with honest progress: per-file state, an aggregate fraction,
 * a smoothed transfer speed (EMA over timed byte callbacks — raw deltas jitter too much to show),
 * and a time-remaining estimate. Sequential on purpose: the server streams each body to disk on
 * boat-grade hardware, so parallel uploads would fight for I/O and make every estimate a lie.
 * Failures and cancellations are isolated per file — the file's bytes drop out of the totals and
 * the rest of the batch still uploads. Pure logic with an injected transport + clock, so it is
 * unit-testable without XHR.
 */

export interface IUploadFileState {
  name: string;
  size: number;
  state: 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';
  /** 0..1 within this file. */
  progress: number;
  /** Human-readable reason, present when state is 'failed'. */
  error?: string;
}

export interface IUploadProgress {
  files: IUploadFileState[];
  /** Index of the file currently uploading; null before start and after the queue finishes. */
  currentIndex: number | null;
  /** Aggregate bytes sent, excluding failed/cancelled files. */
  bytesSent: number;
  /** Aggregate bytes to send, excluding failed/cancelled files. */
  bytesTotal: number;
  /** 0..1 aggregate across the batch. */
  fraction: number;
  /** Smoothed transfer speed; null until the first measurable interval. */
  bytesPerSecond: number | null;
  /** Estimated seconds remaining; null until the speed is known. */
  etaSeconds: number | null;
  done: boolean;
}

/** Uploads one file, reporting absolute bytes sent so far; resolves on success. */
export type IUploadTransport = (
  file: File,
  onBytes: (sent: number) => void,
  signal?: AbortSignal,
) => Promise<unknown>;

export interface IUploadAllOptions {
  onProgress?: (progress: IUploadProgress) => void;
  /** Injectable clock (ms) for deterministic speed/ETA tests. */
  now?: () => number;
  /** Maps a transport rejection to user-facing copy (falls back to the error's message). */
  errorText?: (err: unknown) => string;
}

export interface IUploadHandle {
  done: Promise<IUploadFileState[]>;
  /** Cancel one file: skipped if still queued, aborted if in flight; done/failed are no-ops. */
  cancelFile(index: number): void;
  /** Cancel the current file and everything still queued. */
  cancelAll(): void;
}

// EMA weight for the newest speed sample: responsive without the raw-jitter whiplash.
const SPEED_ALPHA = 0.4;

export function uploadAll(
  queue: readonly File[],
  transport: IUploadTransport,
  options: IUploadAllOptions = {},
): IUploadHandle {
  const now = options.now ?? (() => Date.now());
  const files: IUploadFileState[] = queue.map((f) => ({
    name: f.name,
    size: f.size,
    state: 'queued',
    progress: 0,
  }));
  const cancelled = new Set<number>();
  const controllers = new Map<number, AbortController>();

  let bytesTotal = queue.reduce((sum, f) => sum + f.size, 0);
  let doneBytes = 0; // completed files' bytes (failed/cancelled files never count)
  let currentSent = 0;
  let currentIndex: number | null = null;
  let ema: number | null = null;
  let lastT = now();
  let lastSent = 0;

  const emit = (done: boolean): void => {
    const bytesSent = doneBytes + currentSent;
    options.onProgress?.({
      files: files.map((f) => ({ ...f })),
      currentIndex,
      bytesSent,
      bytesTotal,
      fraction: done ? 1 : bytesTotal > 0 ? Math.min(1, bytesSent / bytesTotal) : 0,
      bytesPerSecond: ema,
      etaSeconds: ema && ema > 0 ? Math.max(0, (bytesTotal - bytesSent) / ema) : null,
      done,
    });
  };

  /** Drop a not-yet-finished file out of the batch accounting. */
  const withdraw = (index: number, state: 'failed' | 'cancelled', error?: string): void => {
    files[index].state = state;
    if (error !== undefined) files[index].error = error;
    bytesTotal -= queue[index].size;
    lastSent = Math.min(lastSent, doneBytes);
  };

  const run = async (): Promise<IUploadFileState[]> => {
    for (let i = 0; i < queue.length; i += 1) {
      if (cancelled.has(i)) {
        continue; // withdrawn while queued — already accounted for
      }
      currentIndex = i;
      currentSent = 0;
      files[i].state = 'uploading';
      const controller = new AbortController();
      controllers.set(i, controller);
      emit(false);

      const onBytes = (sent: number): void => {
        currentSent = Math.min(sent, queue[i].size);
        files[i].progress = queue[i].size > 0 ? currentSent / queue[i].size : 1;
        const t = now();
        const dt = t - lastT;
        if (dt > 0) {
          const instant = ((doneBytes + currentSent - lastSent) * 1000) / dt;
          ema = ema === null ? instant : SPEED_ALPHA * instant + (1 - SPEED_ALPHA) * ema;
          lastT = t;
          lastSent = doneBytes + currentSent;
        }
        emit(false);
      };

      try {
        await transport(queue[i], onBytes, controller.signal);
        files[i].state = 'done';
        files[i].progress = 1;
        doneBytes += queue[i].size;
      } catch (err) {
        if (cancelled.has(i)) {
          // The user cancelled it mid-flight — that is not a failure.
          withdraw(i, 'cancelled');
        } else {
          withdraw(
            i,
            'failed',
            options.errorText?.(err) ?? (err instanceof Error ? err.message : 'upload failed'),
          );
        }
      } finally {
        controllers.delete(i);
        currentSent = 0;
      }
      emit(false);
    }
    currentIndex = null;
    emit(true);
    return files;
  };

  const cancelFile = (index: number): void => {
    const file = files[index];
    if (!file || file.state === 'done' || file.state === 'failed' || file.state === 'cancelled') {
      return;
    }
    cancelled.add(index);
    if (file.state === 'queued') {
      withdraw(index, 'cancelled');
      emit(false);
      return;
    }
    // In flight: abort the transport; the run loop marks it cancelled when the rejection lands.
    controllers.get(index)?.abort();
  };

  return {
    done: run(),
    cancelFile,
    cancelAll: () => {
      for (let i = files.length - 1; i >= 0; i -= 1) {
        cancelFile(i);
      }
    },
  };
}
