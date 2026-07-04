import { API_BASE, ApiError, type IVideoAsset } from '../api';

/**
 * The resuming upload transport: opens a resumable session, streams the file from the current
 * offset, and on a transient failure (dropped wifi, gateway hiccup, server restart) probes the
 * server for how far the bytes actually got and RESUMES from there instead of restarting — the
 * difference between "retry a 300 MB file at 87%" and "start over" on a marina link. Permanent
 * rejections (a 4xx the server will repeat) never retry. Wire calls are injected so the retry
 * logic is unit-testable without XHR.
 */

export interface IUploadWire {
  create(file: File): Promise<{ id: string; offset: number }>;
  /** Send the file's bytes from `offset`, reporting ABSOLUTE bytes sent (offset + on-wire). */
  append(
    id: string,
    file: File,
    offset: number,
    onBytes: (sent: number) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  probe(id: string): Promise<{ offset: number }>;
  complete(id: string): Promise<unknown>;
  discard(id: string): Promise<void>;
}

export interface IResumableUploadOptions {
  onBytes?: (sent: number) => void;
  signal?: AbortSignal;
  /** Total append attempts before giving up (default 4). */
  attempts?: number;
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 4;
const defaultBackoff = (attempt: number): number => Math.min(8000, 500 * 2 ** (attempt - 1));
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A rejection the server would repeat verbatim — retrying cannot help. 408/429 are transient by
 * definition, and 409 is the resume handshake (offset conflict → probe and continue), never fatal.
 */
function isPermanent(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 409 &&
    err.status !== 429
  );
}

export async function resumableUpload(
  file: File,
  wire: IUploadWire,
  options: IResumableUploadOptions = {},
): Promise<unknown> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const backoff = options.backoffMs ?? defaultBackoff;
  const sleep = options.sleep ?? defaultSleep;

  const session = await wire.create(file);
  let offset = session.offset;

  const bail = async (err: unknown): Promise<never> => {
    await wire.discard(session.id).catch(() => undefined);
    throw err;
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await wire.append(
        session.id,
        file,
        offset,
        (sent) => options.onBytes?.(sent),
        options.signal,
      );
      const asset = await wire.complete(session.id);
      return asset;
    } catch (err) {
      if (options.signal?.aborted) {
        return bail(err); // the user cancelled — no probing, no retrying
      }
      if (isPermanent(err)) {
        return bail(err);
      }
      if (attempt === attempts) {
        return bail(err); // budget exhausted — surface the last failure honestly
      }
      await sleep(backoff(attempt));
      try {
        offset = (await wire.probe(session.id)).offset;
      } catch {
        // The probe itself failed (still offline?) — keep the old offset; the next
        // append verifies it server-side anyway, and the attempt budget still applies.
      }
    }
  }
  // Unreachable: every path in the loop returns or throws.
  throw new Error('upload did not settle');
}

// ---- The concrete wire against the plugin's resumable routes ----

async function wireJson<T>(path: string, init: RequestInit, what: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new ApiError(`${what} failed (${res.status})`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const httpWire: IUploadWire = {
  create: (file) =>
    wireJson(
      '/videos/uploads',
      { method: 'POST', body: JSON.stringify({ name: file.name, size: file.size }) },
      'upload',
    ),
  append: (id, file, offset, onBytes, signal) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PATCH', `${API_BASE}/videos/uploads/${encodeURIComponent(id)}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Upload-Offset', String(offset));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onBytes(offset + e.loaded);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new ApiError(`upload failed (${xhr.status})`, xhr.status));
      };
      xhr.onerror = () => reject(new ApiError('upload failed (network)', 0));
      xhr.onabort = () => reject(new ApiError('upload cancelled', 0));
      if (signal) {
        if (signal.aborted) {
          reject(new ApiError('upload cancelled', 0));
          return;
        }
        signal.addEventListener('abort', () => xhr.abort());
      }
      xhr.send(file.slice(offset));
    }),
  probe: (id) =>
    wireJson(`/videos/uploads/${encodeURIComponent(id)}`, { method: 'GET' }, 'upload probe'),
  complete: (id) =>
    wireJson(`/videos/uploads/${encodeURIComponent(id)}/complete`, { method: 'POST' }, 'upload'),
  discard: async (id) => {
    await fetch(`${API_BASE}/videos/uploads/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => undefined);
  },
};

/** Upload one video through the resumable protocol, with progress, resume, and retries. */
export const uploadVideoResumable = (
  file: File,
  opts: Pick<IResumableUploadOptions, 'onBytes' | 'signal'> = {},
): Promise<IVideoAsset> => resumableUpload(file, httpWire, opts) as Promise<IVideoAsset>;
