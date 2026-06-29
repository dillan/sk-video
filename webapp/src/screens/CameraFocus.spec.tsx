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
    expect(screen.getByText(/H.264 sub-stream · main is H.265/)).toBeTruthy();
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
});
