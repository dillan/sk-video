import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Mock fetch, routing by URL to a status and a session payload. */
function mockApi(opts: {
  status?: unknown;
  statusOk?: boolean;
  session?: unknown;
  sessionOk?: boolean;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).endsWith('/session')) {
        return Promise.resolve({
          ok: opts.sessionOk ?? true,
          json: async () => opts.session ?? {},
        });
      }
      return Promise.resolve({ ok: opts.statusOk ?? true, json: async () => opts.status ?? {} });
    }),
  );
}

describe('App shell', () => {
  it('renders the SK Video header', () => {
    mockApi({ status: { ready: true } });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'SK Video' })).toBeTruthy();
  });

  it('shows status read from the same-origin /status endpoint', async () => {
    mockApi({ status: { ready: true, cameras: 2, hardware: { tier: 'pi4' } } });
    render(<App />);
    await waitFor(() => expect(screen.getByText('pi4')).toBeTruthy());
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows an honest error when the plugin is unreachable', async () => {
    mockApi({ statusOk: false });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Can’t reach SK Video/)).toBeTruthy());
  });

  it('reflects the auth posture from /session', async () => {
    mockApi({
      status: { ready: true },
      session: { securityEnabled: true, authenticated: false, pluginVersion: '1.1.0' },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('secured · sign in required')).toBeTruthy());
  });
});
