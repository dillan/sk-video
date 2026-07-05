import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { App } from './App';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(
  opts: {
    session?: unknown;
    /** Per-call /session responses (the last one repeats) — for the stale-shell recheck. */
    sessions?: unknown[];
    mob?: unknown;
    cameras?: Record<string, unknown>;
    camerasOk?: boolean;
    vessel?: unknown;
  } = {},
) {
  let sessionCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/session')) {
        if (opts.sessions) {
          const s = opts.sessions[Math.min(sessionCalls, opts.sessions.length - 1)];
          sessionCalls += 1;
          return ok(s);
        }
        return ok(
          opts.session ?? { securityEnabled: false, authenticated: true, pluginVersion: '1' },
        );
      }
      if (u.endsWith('/mob')) {
        return ok(opts.mob ?? { active: false, targetSource: 'none', aimedCameras: 0 });
      }
      if (u.includes('/resources/cameras')) {
        return opts.camerasOk === false
          ? Promise.resolve({ ok: false, status: 500 })
          : ok(opts.cameras ?? {});
      }
      // The Live Wall's aggregate projection (defs + health + transport + layout in one response).
      if (u.endsWith('/plugins/sk-video/cameras')) {
        if (opts.camerasOk === false) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        const cameras = Object.entries(opts.cameras ?? {})
          .map(([id, c]) => ({
            id,
            ...(c as Record<string, unknown>),
            safetyCritical: false,
            health: null,
            transport: null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return ok({ gatewayOnline: true, cameras, layout: { groups: [] } });
      }
      if (u.includes('/vessels/self')) {
        return ok(opts.vessel ?? {});
      }
      if (u.includes('/transport')) {
        return ok({ recommended: ['mjpeg'], codecs: [], online: false, note: '' });
      }
      return ok({});
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('App shell', () => {
  it('renders the primary navigation', () => {
    mockApi();
    render(<App />);
    for (const label of ['Live', 'Library', 'Cameras', 'Safety']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    }
  });

  it('shows the boat’s cameras on the Live Wall', async () => {
    mockApi({
      cameras: {
        bow: { name: 'Bow', enabled: true, placement: { mount: 'bow', bearingRelativeDeg: 350 } },
        stern: { name: 'Stern', enabled: true },
      },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Bow')).toBeTruthy());
    expect(screen.getByText('Stern')).toBeTruthy();
    // The header leads with the camera count and may append a live-state tally (e.g. "· 2 reconnecting").
    expect(screen.getByText(/^2 cameras/)).toBeTruthy();
  });

  it('opens Camera Focus when a tile is tapped', async () => {
    mockApi({ cameras: { bow: { name: 'Bow', enabled: true } } });
    render(<App />);
    const tile = await screen.findByRole('button', { name: /Bow —/ });
    fireEvent.click(tile);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to Live' })).toBeTruthy());
  });

  it('shows an honest empty state when there are no cameras', async () => {
    mockApi({ cameras: {} });
    render(<App />);
    await waitFor(() => expect(screen.getByText('No cameras yet.')).toBeTruthy());
  });

  it('shows "No GPS fix" honestly when the vessel has no position', async () => {
    mockApi({ cameras: { bow: { name: 'Bow', enabled: true } }, vessel: {} });
    render(<App />);
    await waitFor(() => expect(screen.getByText('No GPS fix')).toBeTruthy());
  });

  it('navigates to the Cameras manage screen when its nav item is tapped', async () => {
    mockApi();
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cameras' })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a camera' })).toBeTruthy());
  });

  it('keeps the telemetry strip persistent on every screen (a shell concern, not a page header)', async () => {
    mockApi({
      mob: {
        active: true,
        targetSource: 'datum',
        aimedCameras: 1,
        capableCameras: 1,
        aimedCameraIds: ['bow'],
        armedAt: Date.UTC(2026, 0, 1, 12, 0),
        lastReaimAt: null,
      },
    });
    render(<App />);
    // On the Live landing…
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByText('MOB ACTIVE')).toBeTruthy();
    // …and still there after navigating away (with the armed-at stamp riding along).
    fireEvent.click(screen.getAllByRole('button', { name: 'Cameras' })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a camera' })).toBeTruthy());
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('MOB ACTIVE')).toBeTruthy();
  });

  it('offers a reload when the served plugin version changes while the tab was away', async () => {
    // A helm tab can outlive a plugin update: /session is rechecked on tab foreground, and a changed
    // pluginVersion earns a non-modal reload prompt (the stale shell keeps working meanwhile).
    const at = (v: string) => ({ securityEnabled: false, authenticated: true, pluginVersion: v });
    mockApi({ sessions: [at('1.0.0'), at('1.1.0')] });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Open server')).toBeTruthy()); // first /session done
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() =>
      expect(screen.getByText(/SK Video was updated — reload for the new version/)).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('does not prompt for a reload when the plugin version is unchanged on foreground', async () => {
    const at = (v: string) => ({ securityEnabled: false, authenticated: true, pluginVersion: v });
    mockApi({ sessions: [at('1.0.0'), at('1.0.0')] });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Open server')).toBeTruthy());
    fireEvent(document, new Event('visibilitychange'));
    // Let the recheck settle, then assert the prompt never appeared.
    await waitFor(() =>
      expect(
        (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) =>
          String(u).includes('/session'),
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(screen.queryByText(/SK Video was updated/)).toBeNull();
  });

  it('shows the in-app sign-in form on a secured server when not authenticated', async () => {
    mockApi({ session: { securityEnabled: true, authenticated: false, pluginVersion: '1' } });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('form', { name: /Sign in to Signal K/ })).toBeTruthy(),
    );
    expect(screen.getByPlaceholderText('Username')).toBeTruthy();
  });
});
