import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Cameras } from './Cameras';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(opts: { cameras?: Record<string, unknown>; presence?: unknown } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/credentials'))
        return ok(opts.presence ?? { hasUsername: false, hasPassword: false });
      if (u.includes('/resources/cameras')) {
        if (init?.method === 'PUT' || init?.method === 'DELETE') return ok({});
        return ok(opts.cameras ?? {});
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
