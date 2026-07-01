import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { CameraFocus } from './CameraFocus';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(
  opts: { cameras?: Record<string, unknown>; snapshot?: unknown; snapshotOk?: boolean } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/snapshot') && init?.method === 'POST') {
        return opts.snapshotOk === false
          ? Promise.resolve({ ok: false, status: 401 })
          : ok(opts.snapshot ?? { hasFix: true });
      }
      if (u.includes('/ptz/presets')) return ok([]);
      if (u.includes('/ptz/position')) return ok({ zoom: 0.2 });
      if (u.includes('/transport')) {
        return ok({ recommended: ['mjpeg'], codecs: [], online: false, note: '' });
      }
      if (u.includes('/resources/cameras')) {
        return ok(opts.cameras ?? {});
      }
      return ok({});
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CameraFocus', () => {
  it('shows the camera name and a back affordance', async () => {
    mockApi({ cameras: { bow: { name: 'Foredeck', enabled: true } } });
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByText('Foredeck')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Back to Live' })).toBeTruthy();
    // The MJPEG rung renders an <img> on the video mat.
    expect(document.querySelector('img.player__media')).toBeTruthy();
  });

  it('reports an honest "no GPS fix" result after a snapshot', async () => {
    mockApi({ cameras: { bow: { name: 'Foredeck', enabled: true } }, snapshot: { hasFix: false } });
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    await waitFor(() => expect(screen.getByText(/no GPS fix, position not stamped/)).toBeTruthy());
  });

  it('asks the operator to sign in when a control is rejected with 401', async () => {
    mockApi({ cameras: { bow: { name: 'Foredeck', enabled: true } }, snapshotOk: false });
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    await waitFor(() => expect(screen.getByText(/Sign in to Signal K/)).toBeTruthy());
  });

  it('shows a not-found state for an unknown camera', async () => {
    mockApi({ cameras: {} });
    render(<CameraFocus cameraId="ghost" onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByText('Camera not found.')).toBeTruthy());
  });

  it('renders the PTZ pad but disables the aim + zoom on a still-refresh feed, and says why', async () => {
    // The pad is the primary control, but continuous PTZ is unsafe/laggy at ~1 fps, so on the MJPEG
    // still-refresh rung the aim group + zoom are disabled, the full-frame drag surface is gone, and
    // an honest caption explains it.
    mockApi({ cameras: { bow: { name: 'Foredeck', enabled: true, capabilities: { ptz: true } } } });
    const { container } = render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    expect(container.querySelector('ptz-pad-variant')).toBeTruthy();
    expect(container.querySelector('.focus__gestures')).toBeNull();
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/still-refresh ~1 fps — PTZ paused/)).toBeTruthy();
  });

  it('surfaces the server’s actionable hint (not "try again") when a camera action fails', async () => {
    // The server diagnoses why an ONVIF action failed (e.g. ONVIF on the wrong port); the operator
    // should see that next step. Driven here through a vision-mode (imaging) apply, which isn't gated
    // by the still-refresh rung.
    const hint = 'Reached the camera but not its ONVIF service. Enable ONVIF on the camera.';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/imaging') && init?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 502,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: hint, reason: 'onvif' }),
          });
        }
        if (u.includes('/ptz/presets')) return ok([]);
        if (u.includes('/ptz/position')) return ok({ zoom: 0.2 });
        if (u.includes('/transport'))
          return ok({ recommended: ['mjpeg'], codecs: [], online: false });
        if (u.includes('/resources/cameras'))
          return ok({ bow: { name: 'Foredeck', enabled: true, capabilities: { ptz: true } } });
        return ok({});
      }),
    );
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    fireEvent.click(screen.getByRole('button', { name: 'Vision mode' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Day/ }));
    await waitFor(() => expect(screen.getByText(hint)).toBeTruthy());
    expect(screen.queryByText(/try again/)).toBeNull();
  });

  const playerSrc = () => document.querySelector('img.player__media')?.getAttribute('src') ?? '';

  it('plays the H.264 sub-stream when the main codec is H.265 and a substream exists', async () => {
    mockApi({
      cameras: {
        bow: {
          name: 'Foredeck',
          enabled: true,
          capabilities: { substreams: true },
          media: { codec: 'h265', substreamPath: '/Preview_01_sub' },
        },
      },
    });
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    await waitFor(() => expect(playerSrc()).toContain('variant=sub'));
    expect(screen.getByText(/H.264 sub · main is H.265/)).toBeTruthy();
  });

  it('falls back to the sub-stream when go2rtc negotiated HEVC at runtime', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = String(url);
        if (u.includes('/transport'))
          return ok({ recommended: ['mjpeg'], codecs: ['H265'], online: true, note: '' });
        if (u.includes('/resources/cameras'))
          return ok({
            bow: {
              name: 'Foredeck',
              enabled: true,
              capabilities: { substreams: true },
              media: { substreamPath: '/Preview_01_sub' },
            },
          });
        return ok({});
      }),
    );
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    await waitFor(() => expect(playerSrc()).toContain('variant=sub'));
  });

  it('does not request the sub when the capability is set but no substream path was stored', async () => {
    // The server serves `?variant=sub` from media.substreamPath, so a cap with no path must not switch.
    mockApi({
      cameras: {
        bow: {
          name: 'Foredeck',
          enabled: true,
          capabilities: { substreams: true },
          media: { codec: 'h265' },
        },
      },
    });
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    await waitFor(() => expect(document.querySelector('img.player__media')).toBeTruthy());
    expect(playerSrc()).not.toContain('variant=sub');
  });

  it('plays the main stream for an H.264 camera (no sub variant, no note)', async () => {
    mockApi({
      cameras: {
        bow: {
          name: 'Foredeck',
          enabled: true,
          capabilities: { substreams: true },
          media: { codec: 'h264' },
        },
      },
    });
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    await waitFor(() => expect(document.querySelector('img.player__media')).toBeTruthy());
    expect(playerSrc()).not.toContain('variant=sub');
    expect(screen.queryByText(/H.264 sub-stream/)).toBeNull();
  });

  it('lets the operator switch sub/main from the stream menu', async () => {
    mockApi({
      cameras: {
        bow: {
          name: 'Foredeck',
          enabled: true,
          capabilities: { substreams: true },
          media: { codec: 'h265', substreamPath: '/Preview_01_sub' },
        },
      },
    });
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    await waitFor(() => expect(playerSrc()).toContain('variant=sub')); // auto-picks the sub

    fireEvent.click(screen.getByRole('button', { name: 'Stream variant' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Main/ }));
    await waitFor(() => expect(playerSrc()).not.toContain('variant=sub'));

    fireEvent.click(screen.getByRole('button', { name: 'Stream variant' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Sub/ }));
    await waitFor(() => expect(playerSrc()).toContain('variant=sub'));
  });

  it('offers only the Main variant in the stream menu when the camera has no sub-stream', async () => {
    mockApi({ cameras: { bow: { name: 'Foredeck', enabled: true } } });
    render(<CameraFocus cameraId="bow" onBack={() => undefined} />);
    await screen.findByText('Foredeck');
    fireEvent.click(screen.getByRole('button', { name: 'Stream variant' }));
    expect(await screen.findByRole('menuitemradio', { name: /Main/ })).toBeTruthy();
    expect(screen.queryByRole('menuitemradio', { name: /Sub/ })).toBeNull();
  });
});
