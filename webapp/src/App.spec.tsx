import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { App } from './App';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(
  opts: {
    session?: unknown;
    mob?: unknown;
    cameras?: Record<string, unknown>;
    camerasOk?: boolean;
    vessel?: unknown;
  } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/session')) {
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
    for (const label of ['Live', 'Review', 'Cameras', 'Safety']) {
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
    expect(screen.getByText('2 cameras')).toBeTruthy();
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

  it('shows a sign-in-required banner on a secured server when not authenticated', async () => {
    mockApi({ session: { securityEnabled: true, authenticated: false, pluginVersion: '1' } });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Sign-in required/)).toBeTruthy());
  });
});
