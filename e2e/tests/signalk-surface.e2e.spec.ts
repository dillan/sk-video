import { test, expect } from '@playwright/test';
import {
  BASE,
  plugin,
  resource,
  ensureCamera,
  getPluginConfig,
  setPluginConfig,
  waitForReady,
  waitForStatus,
  pollJson,
} from './helpers';

/**
 * The plugin's Signal K surface, end-to-end against a real server + a real (simulated) camera:
 * per-camera health paths with meta, the camera-dark alarm on the camera's own notification path
 * (raise → ack → clear, and re-raise across a plugin restart via the persisted last-good stamp),
 * the zones opt-in handover (the SERVER raises the alarm), writable PUT controls, resource-change
 * deltas reaching a plain v1-stream subscriber, and the capability manifest in the projection.
 *
 * The harness sets SKVIDEO_WATCHDOG_POLL_MS=2000, so outage scenarios settle in seconds:
 * fail threshold 3 polls ≈ 6s, recover threshold 2 polls ≈ 4s.
 */

const CAM = 'healthcam';
/** A full-model node URL under vessels.self. */
const selfModel = (dotted: string): string =>
  `${BASE}/signalk/v1/api/vessels/self/${dotted.split('.').join('/')}`;

type ModelNode = { value?: unknown; $source?: string; meta?: Record<string, unknown> } | null;

const nodeState = (node: ModelNode): string | null => {
  const v = (node as { value?: { state?: string } } | null)?.value;
  return typeof v?.state === 'string' ? v.state : v === null ? 'cleared' : null;
};

/** Point the camera at a live/dead stream path (the sim camera only serves /cam). */
async function pointCamera(
  request: Parameters<typeof ensureCamera>[0],
  path: string,
): Promise<void> {
  await request.put(resource(CAM), {
    data: {
      name: 'Health Camera',
      enabled: true,
      safetyCritical: true,
      source: { scheme: 'rtsp', host: 'mediamtx', port: 8554, path },
    },
  });
}

/** Warm the stream (a frame request makes go2rtc connect the producer) and wait for gauge 0. */
async function warmUntilHealthy(request: Parameters<typeof ensureCamera>[0]): Promise<void> {
  await waitForStatus(request, plugin(`/cameras/${CAM}/frame.jpeg`), 200);
  const healthy = await pollJson<ModelNode>(
    request,
    selfModel(`cameras.${CAM}.feedOutage`),
    (node) => (node as { value?: unknown } | null)?.value === 0,
    30_000,
  );
  expect(healthy, 'gauge never reached 0 — camera not seen healthy').not.toBeNull();
}

/** Wait for the camera-dark notification to reach one of the given states. */
async function waitForAlarmState(
  request: Parameters<typeof ensureCamera>[0],
  states: string[],
  timeoutMs = 40_000,
): Promise<ModelNode> {
  const node = await pollJson<ModelNode>(
    request,
    selfModel(`notifications.cameras.${CAM}.feedOutage`),
    (n) => states.includes(nodeState(n) ?? ''),
    timeoutMs,
  );
  expect(node, `notification never reached ${states.join('/')}`).not.toBeNull();
  return node;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

test.beforeAll(async ({ request }) => {
  await waitForReady(request);
  await pointCamera(request, '/cam');
});

test.afterAll(async ({ request }) => {
  // Leave the shared stack the way we found it for the specs that follow.
  await request.delete(resource(CAM)).catch(() => undefined);
});

test('publishes per-camera health paths with self-describing meta (F7)', async ({ request }) => {
  await warmUntilHealthy(request);

  const producers = (await request.get(selfModel(`cameras.${CAM}.producers`))).ok();
  expect(producers).toBe(true);

  const meta = (await (await request.get(selfModel(`cameras.${CAM}.feedOutage/meta`))).json()) as {
    units?: string;
    displayName?: string;
  };
  expect(meta.units).toBe('s');
  expect(meta.displayName).toContain('Health Camera');
});

test('a dying camera raises its own alarm, is ackable, and clears on recovery (F7)', async ({
  request,
}) => {
  await warmUntilHealthy(request);

  await pointCamera(request, '/no-such-stream'); // the feed goes dark
  const alarm = await waitForAlarmState(request, ['alarm']);
  const value = (alarm as { value?: { message?: string } }).value;
  expect(value?.message).toContain('Health Camera');

  // Shared-state acknowledge through the plugin route, by the same key the delta stream exposes.
  const ack = await request.post(plugin('/notifications/ack'), {
    data: { key: `cameras.${CAM}.feedOutage` },
  });
  expect(ack.status()).toBe(204);

  await pointCamera(request, '/cam'); // recovery
  await warmUntilHealthy(request);
  await waitForAlarmState(request, ['normal', 'cleared']);
});

test('an outage spanning a plugin restart still alarms (persisted last-good) (F7)', async ({
  request,
}) => {
  await warmUntilHealthy(request);
  await pointCamera(request, '/no-such-stream');
  await waitForAlarmState(request, ['alarm']);

  // Restart the plugin mid-outage. stop() clears the alarm; the persisted last-good stamp must
  // let the fresh process re-raise it — a dead camera may not silently become "never seen".
  const config = await getPluginConfig(request);
  await setPluginConfig(request, config.configuration);
  await waitForAlarmState(request, ['alarm'], 60_000);

  await pointCamera(request, '/cam');
  await warmUntilHealthy(request);
  await waitForAlarmState(request, ['normal', 'cleared']);
});

test('camera controls are writable through standard Signal K PUT (F8)', async ({ request }) => {
  // The path advertises writability the way generic clients discover it.
  const meta = (await (await request.get(selfModel(`cameras.${CAM}.recording/meta`))).json()) as {
    supportsPut?: boolean;
  };
  expect(meta.supportsPut).toBe(true);

  const start = await request.put(selfModel(`cameras.${CAM}.recording`), {
    data: { value: true },
  });
  expect(start.ok(), `PUT recording=true answered ${start.status()}`).toBe(true);

  const stop = await request.put(selfModel(`cameras.${CAM}.recording`), {
    data: { value: false },
  });
  expect(stop.ok()).toBe(true);
});

/** The current operational config, reshaped so it can be PUT back verbatim (restore payload). */
async function readRestorableConfig(
  request: Parameters<typeof ensureCamera>[0],
): Promise<Record<string, unknown>> {
  const res = await request.get(plugin('/operational-config'));
  const body = (await res.json()) as Record<string, unknown> & {
    frigate?: Record<string, unknown>;
  };
  const frigate = { ...(body.frigate ?? {}) };
  delete frigate.mqttPasswordSet; // read-side presence flag; the PUT schema rejects it
  return { ...body, frigate };
}

test('zones opt-in hands the alarm to the server, which raises it from meta.zones (F7)', async ({
  request,
}) => {
  // Snapshot the shared harness config — the PUT replaces the WHOLE document, and later specs
  // depend on what it holds (e.g. the hardwareTier override).
  const before = await readRestorableConfig(request);

  const put = await request.put(plugin('/operational-config'), {
    data: {
      ...before,
      cameraHealthZones: { [CAM]: { warnAfterSeconds: 4, alarmAfterSeconds: 8 } },
    },
  });
  expect(put.ok()).toBe(true);
  await waitForReady(request); // the config write restarts the plugin

  await warmUntilHealthy(request);
  const meta = (await (await request.get(selfModel(`cameras.${CAM}.feedOutage/meta`))).json()) as {
    zones?: unknown[];
  };
  expect(Array.isArray(meta.zones) && meta.zones.length >= 2).toBe(true);

  await pointCamera(request, '/no-such-stream');
  const alarm = await waitForAlarmState(request, ['alarm']);
  // The SERVER's zone watcher raised this one — the handover is real, and single-authority.
  expect((alarm as { $source?: string }).$source).toBe('self.notificationhandler');

  // Recovery drives the gauge back into the normal zone; the server clears its own alarm.
  await pointCamera(request, '/cam');
  await warmUntilHealthy(request);
  await waitForAlarmState(request, ['normal', 'cleared']);

  // Put the shared config back exactly as we found it (authority returns to the plugin).
  const reset = await request.put(plugin('/operational-config'), { data: before });
  expect(reset.ok()).toBe(true);
  await waitForReady(request);
});

test('resource changes reach a plain v1-stream subscriber as deltas (F9)', async ({
  request,
  page,
}) => {
  await page.goto(`${BASE}/`);
  const received = page.evaluate(
    ({ streamUrl }) =>
      new Promise<{ created: unknown; tombstone: boolean }>((resolve, reject) => {
        const ws = new WebSocket(streamUrl);
        const seen: Record<string, unknown[]> = {};
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error(`no resource deltas; saw ${JSON.stringify(seen)}`));
        }, 30_000);
        ws.onopen = () =>
          ws.send(
            JSON.stringify({
              context: 'vessels.self',
              subscribe: [{ path: 'resources.cameras.*', policy: 'instant' }],
            }),
          );
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data)) as {
            updates?: { values?: { path: string; value: unknown }[] }[];
          };
          for (const update of msg.updates ?? []) {
            for (const pv of update.values ?? []) {
              if (pv.path === 'resources.cameras.deltacam') {
                (seen[pv.path] ??= []).push(pv.value);
                const values = seen[pv.path];
                if (values.length >= 2 && values[values.length - 1] === null) {
                  clearTimeout(timer);
                  ws.close();
                  resolve({ created: values[0], tombstone: true });
                }
              }
            }
          }
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error('stream socket error'));
        };
      }),
    { streamUrl: `${BASE.replace(/^http/, 'ws')}/signalk/v1/stream?subscribe=none` },
  );

  // Give the subscription a beat, then create + delete a camera through the Resources API.
  await page.waitForTimeout(1000);
  await ensureCamera(request, 'deltacam', { name: 'Delta Camera' });
  await page.waitForTimeout(1000);
  await request.delete(resource('deltacam'));

  const outcome = await received;
  expect((outcome.created as { name?: string })?.name).toBe('Delta Camera');
  expect(outcome.tombstone).toBe(true);
});

test('the wall projection carries the capability manifest (F8)', async ({ request }) => {
  const res = await request.get(plugin('/cameras'));
  expect(res.headers()['cache-control']).toBe('no-cache');
  const body = (await res.json()) as {
    cameras: { id: string; manifest?: { supportedFeatures: string[]; streams: { hls: string } } }[];
  };
  const cam = body.cameras.find((c) => c.id === CAM);
  expect(cam?.manifest?.supportedFeatures).toContain('snapshots');
  expect(cam?.manifest?.streams.hls).toBe(`/plugins/sk-video/cameras/${CAM}/stream.m3u8`);
  expect(JSON.stringify(cam?.manifest)).not.toContain('mediamtx'); // never a network address
});
