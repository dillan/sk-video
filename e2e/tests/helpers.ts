import { type APIRequestContext } from '@playwright/test';

/** The Signal K base URL the stack serves on (override with SIGNALK_URL). */
export const BASE = process.env.SIGNALK_URL || 'http://localhost:3000';
/** Build a sk-video plugin URL. */
export const plugin = (path: string): string => `${BASE}/plugins/sk-video${path}`;
/** Build a Signal K cameras-resource URL. */
export const resource = (id: string): string => `${BASE}/signalk/v2/api/resources/cameras/${id}`;

export const CAMERA = 'testcam';

/** Idempotently register a camera resource (the gateway warms go2rtc from it). */
export async function ensureCamera(
  request: APIRequestContext,
  id = CAMERA,
  over: Record<string, unknown> = {},
): Promise<void> {
  await request
    .put(resource(id), {
      data: {
        name: 'Test Camera',
        enabled: true,
        source: { scheme: 'rtsp', host: 'mediamtx', port: 8554, path: '/cam' },
        ...over,
      },
    })
    .catch(() => undefined);
}

/** Poll a URL until it returns the expected status (go2rtc/ffmpeg need a few seconds to warm up). */
export async function waitForStatus(
  request: APIRequestContext,
  url: string,
  expected = 200,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    const res = await request.get(url).catch(() => null);
    last = res?.status() ?? 0;
    if (last === expected) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out waiting for ${expected} from ${url} (last status ${last})`);
}

/** Poll a JSON endpoint until `predicate(body)` is true; returns the body, or null on timeout. */
export async function pollJson<T = unknown>(
  request: APIRequestContext,
  url: string,
  predicate: (body: T) => boolean,
  timeoutMs = 30_000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(url).catch(() => null);
    if (res?.ok()) {
      const body = (await res.json()) as T;
      if (predicate(body)) return body;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}
