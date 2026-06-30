import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Events } from './Events';
import type { ILoggedEvent } from '../api';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EVENTS: ILoggedEvent[] = [
  { id: 'e3', at: 3000, type: 'camera.bow.offline', state: 'alert', message: 'Bow camera offline' },
  { id: 'e2', at: 2000, type: 'incident', state: 'warn', message: 'Incident captured' },
  { id: 'e1', at: 1000, type: 'mob', state: 'emergency', message: 'Person overboard' },
];

describe('Events', () => {
  it('renders the feed with human labels and severity styling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ok({ events: EVENTS })),
    );
    render(<Events />);
    await waitFor(() => expect(screen.getByText('Man overboard')).toBeTruthy());
    // a camera-offline key is humanised with the camera id
    expect(screen.getByText(/Camera offline/)).toBeTruthy();
    expect(screen.getByText('Bow camera offline')).toBeTruthy();
    // the emergency row carries the alarm treatment
    expect(document.querySelector('.chip--alarm')).toBeTruthy();
  });

  it('shows an honest empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ok({ events: [] })),
    );
    render(<Events />);
    await waitFor(() => expect(screen.getByText(/No events yet/)).toBeTruthy());
  });

  it('badges a Frigate row as close-range, not a hazard detector', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ok({ events: [{ id: 'f1', at: 5000, type: 'frigate.person', state: 'alert' }] })),
    );
    render(<Events />);
    await waitFor(() => expect(screen.getByText(/close-range/)).toBeTruthy());
  });

  it('pages older events with the before cursor', async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(ok({ events: EVENTS }))
      .mockReturnValueOnce(
        ok({ events: [{ id: 'e0', at: 500, type: 'anchor.drag', state: 'alarm' }] }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<Events />);
    await waitFor(() => expect(screen.getByText('Man overboard')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Load older/ }));
    await waitFor(() => expect(screen.getByText(/Anchor watch/)).toBeTruthy());
    // the second request asked for events strictly older than the oldest currently shown (at=1000)
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain('before=1000');
  });
});
