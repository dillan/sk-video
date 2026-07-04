import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SafetyBanner } from './SafetyBanner';
import type { IAlert } from '../lib/sk-stream';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const alert = (over: Partial<IAlert> = {}): IAlert => ({
  key: 'mob',
  state: 'emergency',
  message: 'Person overboard',
  silenced: false,
  ...over,
});

describe('SafetyBanner', () => {
  it('renders nothing with no active alerts', () => {
    const { container } = render(<SafetyBanner alerts={{}} />);
    expect(container.innerHTML).toBe('');
  });

  it('escalates a live alarm to a full-bleed banner with a shared Acknowledge', () => {
    render(<SafetyBanner alerts={{ mob: alert() }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Person overboard')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
  });

  it('demotes an acknowledged alarm to a quiet chip — visible, not dismissed', () => {
    render(<SafetyBanner alerts={{ mob: alert({ silenced: true }) }} />);
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.getByText(/acknowledged · Person overboard/)).toBeTruthy();
  });

  it('keeps warn-level notifications as chips, never full-bleed', () => {
    render(
      <SafetyBanner
        alerts={{ fog: alert({ key: 'fog', state: 'warn', message: 'Fog preset' }) }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.getByText('Fog preset')).toBeTruthy();
  });

  it('POSTs the shared ack for the alarm key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SafetyBanner alerts={{ mob: alert() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/notifications/ack');
    expect(JSON.parse(String(init.body))).toEqual({ key: 'mob' });
  });
});
