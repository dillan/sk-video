import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { IActivity } from '../api';

const api = vi.hoisted(() => ({ fetchActivity: vi.fn() }));
vi.mock('../api', () => api);

import { ActivityMonitor } from './ActivityMonitor';

const SAMPLE: IActivity = {
  cpu: { cores: 4, utilization: 0.72, loadAvg1: 2.9 },
  memory: { totalBytes: 8_000_000_000, usedBytes: 6_000_000_000, utilization: 0.75 },
  temperatureC: 74,
  processes: [
    { pid: 20, name: 'ffmpeg', cpuPercent: 180, rssBytes: 90_000_000 },
    { pid: 10, name: 'go2rtc', cpuPercent: 25, rssBytes: 40_000_000 },
  ],
  verdict: { level: 'busy', headline: 'Working, with headroom to spare.', reasons: ['CPU 72%'] },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActivityMonitor', () => {
  it('renders the verdict, the three meters, and the heaviest processes', async () => {
    api.fetchActivity.mockResolvedValue(SAMPLE);
    render(<ActivityMonitor />);
    await waitFor(() => screen.getByText('Working, with headroom to spare.'));
    expect(screen.getByText(/CPU 72%/)).toBeTruthy();
    // Meters expose their value strings.
    expect(screen.getByText(/72% · load 2.90/)).toBeTruthy();
    expect(screen.getByText(/74°C/)).toBeTruthy();
    // Process table lists the spawned children.
    expect(screen.getByText('ffmpeg')).toBeTruthy();
    expect(screen.getByText('go2rtc')).toBeTruthy();
    expect(screen.getByText('180%')).toBeTruthy();
  });

  it('says temperature is not reported when the host has none', async () => {
    api.fetchActivity.mockResolvedValue({ ...SAMPLE, temperatureC: null });
    render(<ActivityMonitor />);
    await waitFor(() => screen.getByText('not reported'));
  });

  it('shows a caution chip when activity can’t be read', async () => {
    api.fetchActivity.mockRejectedValue(new Error('unreachable'));
    render(<ActivityMonitor />);
    await waitFor(() => screen.getByText(/Can’t read device activity/));
  });
});
