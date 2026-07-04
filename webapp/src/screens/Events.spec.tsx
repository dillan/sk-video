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
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/status')) return ok({ ready: true });
      if (u.includes('before='))
        return ok({ events: [{ id: 'e0', at: 500, type: 'anchor.drag', state: 'alarm' }] });
      return ok({ events: EVENTS });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Events />);
    await waitFor(() => expect(screen.getByText('Man overboard')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Load older/ }));
    await waitFor(() => expect(screen.getByText(/Anchor watch/)).toBeTruthy());
    // the follow-up asked for events strictly older than the oldest currently shown (at=1000)
    const older = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('before='));
    expect(older).toContain('before=1000');
  });

  it('re-fetches with the server type filter when a family tab is picked', async () => {
    const fetchMock = vi.fn((url: string) =>
      String(url).includes('/status')
        ? ok({ ready: true })
        : ok({ events: String(url).includes('type=camera') ? [EVENTS[0]] : EVENTS }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Events />);
    await waitFor(() => expect(screen.getByText('Man overboard')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Cameras' }));
    await waitFor(() => expect(screen.queryByText('Man overboard')).toBeNull());
    expect(screen.getByText(/Camera offline/)).toBeTruthy();
    // camera events now live under the `cameras.` key family (camera-path alarms)
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('type=cameras'))).toBe(true);
  });

  it('humanises a camera-path feed-outage row and deep-links to the camera', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        ok({
          events: [
            {
              id: 'e9',
              at: 9000,
              type: 'cameras.stern.feedOutage',
              state: 'alarm',
              message: 'Stern camera has gone dark',
            },
          ],
        }),
      ),
    );
    render(<Events />);
    await waitFor(() => expect(screen.getByText('Camera offline · stern')).toBeTruthy());
    const link = screen.getByRole('link', { name: 'View →' });
    expect(link.getAttribute('href')).toBe('#/live/stern');
  });

  it('says Frigate is not connected instead of implying an empty feed means nothing happened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/status')
          ? ok({ ready: true, frigate: { configured: false, connected: false } })
          : ok({ events: [] }),
      ),
    );
    render(<Events />);
    await waitFor(() => expect(screen.getByText(/Frigate is not connected/)).toBeTruthy());
  });

  it('deep-links an incident row to the Incidents tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ok({ events: [EVENTS[1]] })),
    );
    render(<Events />);
    await waitFor(() => expect(screen.getByText('Incident')).toBeTruthy());
    const link = screen.getByRole('link', { name: 'View →' });
    expect(link.getAttribute('href')).toBe('#/review/incidents');
  });
});
