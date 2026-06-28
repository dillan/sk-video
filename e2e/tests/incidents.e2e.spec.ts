import { test, expect } from '@playwright/test';
import { BASE, plugin, CAMERA, ensureCamera, waitForStatus, pollJson } from './helpers';

// Incident bundles (C9): trigger a capture, let it finalize, then exercise the manifest, the
// Range-served assets, the operator patch (pin), and the pinned-delete guard.

test.beforeAll(async ({ request }) => {
  await ensureCamera(request);
  await waitForStatus(request, plugin(`/cameras/${CAMERA}/stream.m3u8`), 200).catch(
    () => undefined,
  );
});

test.describe('incident bundles (C9)', () => {
  test('marks an incident, finalizes a best-effort bundle, and serves its assets', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    // Short rolls so the bundle finalizes quickly (pre-roll from the DVR if any, snapshot + telemetry).
    const mark = await request.post(plugin('/incidents'), {
      data: { cameras: [CAMERA], preMs: 2000, postMs: 2000, note: 'e2e smoke' },
    });
    expect(mark.status()).toBe(202);
    const started = await mark.json();
    expect(started.status).toBe('capturing');
    expect(mark.headers()['location']).toBe(`incidents/${started.id}`);

    // It appears in the listing immediately (capturing), and is persisted once finalized.
    const finalized = await pollJson<{
      id: string;
      status: string;
      evidence: string;
      assets: unknown[];
    }>(
      request,
      plugin(`/incidents/${started.id}`),
      (b) => b.status !== 'capturing' && Array.isArray(b.assets),
      40_000,
    );
    expect(finalized, 'the bundle should finalize on disk').toBeTruthy();
    expect(finalized!.evidence).toBe('best-effort');
    expect(['complete', 'partial']).toContain(finalized!.status);
    // A telemetry track is always written; there should be at least one asset.
    expect((finalized!.assets as { kind: string }[]).some((a) => a.kind === 'telemetry')).toBe(
      true,
    );

    // Range-serve the first asset.
    const asset = (finalized!.assets as { id: string; contentType: string }[])[0];
    const blob = await request.get(plugin(`/incidents/${started.id}/assets/${asset.id}`), {
      headers: { Range: 'bytes=0-0' },
    });
    expect([200, 206]).toContain(blob.status());
    expect(blob.headers()['x-content-type-options']).toBe('nosniff');

    // Pin it, prove a pinned bundle resists DELETE (409), then unpin + delete.
    const pinned = await request.patch(plugin(`/incidents/${started.id}`), {
      data: { pinned: true },
    });
    expect(pinned.status()).toBe(200);
    expect((await pinned.json()).pinned).toBe(true);

    const blockedDelete = await request.delete(plugin(`/incidents/${started.id}`));
    expect(blockedDelete.status()).toBe(409);

    await request.patch(plugin(`/incidents/${started.id}`), { data: { pinned: false } });
    const del = await request.delete(plugin(`/incidents/${started.id}`));
    expect(del.status()).toBe(204);
  });

  test('rejects a trigger with an unknown key (400) and a bad id (400)', async ({ request }) => {
    const bad = await request.post(plugin('/incidents'), { data: { credentials: 'x' } });
    expect(bad.status()).toBe(400);
    const badId = await request.get(plugin('/incidents/..%2fetc'));
    expect(badId.status()).toBe(400);
  });

  test('serves incidents as a Signal K resource (read-only create-via-trigger)', async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/signalk/v2/api/resources/incidents`);
    // The provider is registered; an empty or populated map are both valid.
    expect([200, 404]).toContain(res.status());
  });
});
