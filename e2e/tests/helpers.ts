import { type APIRequestContext } from '@playwright/test';

/** The Signal K base URL the stack serves on (override with SIGNALK_URL). */
export const BASE = process.env.SIGNALK_URL || 'http://localhost:3000';
/** Build a sk-video plugin URL. */
export const plugin = (path: string): string => `${BASE}/plugins/sk-video${path}`;
/** Build a Signal K cameras-resource URL. */
export const resource = (id: string): string => `${BASE}/signalk/v2/api/resources/cameras/${id}`;

export const CAMERA = 'testcam';

/** Build a Signal K admin (skServer) URL — used to read/update the plugin's own config at runtime. */
export const skServer = (path: string): string => `${BASE}/skServer${path}`;

/** The current sk-video plugin config: { enabled, enableLogging, configuration }. */
export async function getPluginConfig(
  request: APIRequestContext,
): Promise<{ enabled: boolean; enableLogging: boolean; configuration: Record<string, unknown> }> {
  const res = await request.get(skServer('/plugins/sk-video/config'));
  return res.json();
}

/**
 * Replace the plugin config and wait for it to restart ready. Signal K restarts the plugin in-process,
 * re-running start() with the new options. Returns once `/status` reports ready again.
 */
export async function setPluginConfig(
  request: APIRequestContext,
  configuration: Record<string, unknown>,
): Promise<void> {
  await request.post(skServer('/plugins/sk-video/config'), {
    data: { enabled: true, enableLogging: false, configuration },
  });
  await waitForReady(request);
}

/** Poll `/status` until the plugin reports ready (after a start/restart). */
export async function waitForReady(request: APIRequestContext, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(plugin('/status')).catch(() => null);
    if (res?.ok()) {
      const body = (await res.json()) as { ready?: boolean };
      if (body.ready === true) return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('plugin did not report ready in time');
}

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
