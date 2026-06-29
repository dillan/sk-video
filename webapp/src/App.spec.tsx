import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App shell', () => {
  it('renders the SK Video header', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }),
    );
    render(<App />);
    expect(screen.getByRole('heading', { name: 'SK Video' })).toBeTruthy();
  });

  it('shows status read from the same-origin /status endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ready: true, cameras: 2, hardware: { tier: 'pi4' } }),
      }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText('pi4')).toBeTruthy());
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows an honest error when the plugin is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Can’t reach SK Video/)).toBeTruthy());
  });
});
