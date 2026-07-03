import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Cameras } from './Cameras';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(
  opts: {
    cameras?: Record<string, unknown>;
    presence?: unknown;
    rescanResult?: unknown;
    health?: Record<string, unknown>;
  } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/rescan') && init?.method === 'POST') return ok(opts.rescanResult ?? {});
      if (u.includes('/credentials'))
        return ok(opts.presence ?? { hasUsername: false, hasPassword: false });
      if (u.includes('/resources/cameras')) {
        if (init?.method === 'PUT' || init?.method === 'DELETE') return ok({});
        return ok(opts.cameras ?? {});
      }
      // The aggregate projection: rows read their health tri-state from it.
      if (u.endsWith('/plugins/sk-video/cameras')) {
        const cameras = Object.entries(opts.cameras ?? {}).map(([id, c]) => ({
          id,
          ...(c as Record<string, unknown>),
          health: opts.health?.[id] ?? null,
          transport: null,
        }));
        return ok({ gatewayOnline: true, cameras, layout: { groups: [] } });
      }
      return ok({});
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Cameras manage', () => {
  it('shows an empty state and opens the wizard', async () => {
    mockApi({ cameras: {} });
    render(<Cameras />);
    await waitFor(() => expect(screen.getByText('No cameras yet.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add a camera' }));
    expect(screen.getByRole('button', { name: 'Scan the network' })).toBeTruthy();
  });

  it('lists cameras with their state and a stored-login chip', async () => {
    mockApi({
      cameras: {
        bow: {
          name: 'Bow',
          enabled: true,
          source: { scheme: 'rtsp', host: '192.168.1.100' },
          role: 'security',
          capabilities: { absolutePtz: true },
        },
      },
      presence: { hasUsername: true, hasPassword: true },
    });
    render(<Cameras />);
    await waitFor(() => expect(screen.getByText('Bow')).toBeTruthy());
    expect(screen.getByText('PTZ')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('login stored')).toBeTruthy());
  });

  it('shows the health tri-state on each enabled row from the aggregate projection', async () => {
    mockApi({
      cameras: {
        bow: { name: 'Bow', enabled: true, source: { scheme: 'rtsp', host: '10.0.0.9' } },
        stern: { name: 'Stern', enabled: true, source: { scheme: 'rtsp', host: '10.0.0.8' } },
      },
      health: {
        bow: { online: true, producers: 1, consumers: 0, codecs: [], sources: [] },
        stern: {
          online: false,
          producers: 0,
          consumers: 0,
          codecs: [],
          sources: [],
          lastGoodAt: Date.UTC(2026, 0, 1, 12, 0),
          trackedSince: 1,
        },
      },
    });
    render(<Cameras />);
    await waitFor(() => expect(screen.getByText('live')).toBeTruthy());
    expect(screen.getByText(/went dark — last seen live/)).toBeTruthy();
  });

  it('re-scans a camera and saves the refreshed capabilities + device', async () => {
    const calls = mockApi({
      cameras: {
        bow: {
          name: 'Bow',
          enabled: true,
          role: 'security',
          source: { scheme: 'rtsp', host: '192.168.1.100' },
          capabilities: { ptz: true }, // stale: no imaging yet
        },
      },
      rescanResult: {
        ptz: true,
        absolutePtz: true,
        imaging: true,
        imagingControls: ['irCut'],
        audio: true,
        audioBackchannel: false,
        spotlight: false,
        alarm: false,
        firmwareVersion: 'v2.0',
      },
    });
    render(<Cameras />);
    fireEvent.click(await screen.findByRole('button', { name: 'Re-scan' }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.includes('/resources/cameras/bow') && c.init?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(put!.init!.body as string);
      expect(body.capabilities.imaging).toEqual(['irCut']); // refreshed
      expect(body.role).toBe('security'); // preserved
      expect(body.device.firmware).toBe('v2.0'); // captured
    });
  });

  it('disables a camera by re-PUTting the resource with enabled:false', async () => {
    const calls = mockApi({
      cameras: { bow: { name: 'Bow', enabled: true, source: { scheme: 'rtsp', host: 'h' } } },
    });
    render(<Cameras />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(put!.init!.body as string).enabled).toBe(false);
    });
  });

  it('requires a confirm before deleting', async () => {
    const calls = mockApi({
      cameras: { bow: { name: 'Bow', enabled: true, source: { scheme: 'rtsp', host: 'h' } } },
    });
    render(<Cameras />);
    const del = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(del);
    // First click only arms the confirm — no DELETE yet.
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true));
  });
});
