import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Recordings } from './Recordings';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockTimeline(cameras: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => ok({ generatedAt: 0, segmentSeconds: 60, cameras })),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const cam = {
  camera: 'bow',
  recording: true,
  startedAt: 0,
  endedAt: 0,
  segments: [
    {
      name: 'bow_20260101_120000.mp4',
      startedAt: 1_700_000_000_000,
      durationMs: 60_000,
      bytes: 5_000_000,
    },
  ],
  gaps: [{ startedAt: 1_700_000_100_000, endedAt: 1_700_000_200_000, durationMs: 100_000 }],
};

describe('Recordings', () => {
  it('shows per-camera segments, a recording badge, and neutral gap markers', async () => {
    mockTimeline([cam]);
    render(<Recordings />);
    await waitFor(() => expect(screen.getByText('bow')).toBeTruthy());
    expect(screen.getByText('Recording')).toBeTruthy();
    expect(screen.getByText('1:00 · 4.8 MB')).toBeTruthy(); // duration · size
    expect(screen.getByText(/No coverage/)).toBeTruthy(); // gap, no fabricated cause
  });

  it('plays a segment inline', async () => {
    mockTimeline([cam]);
    render(<Recordings />);
    await waitFor(() => expect(screen.getByText('bow')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(document.querySelector('video.vidrow__player')).toBeTruthy();
  });

  it('shows an honest empty state', async () => {
    mockTimeline([]);
    render(<Recordings />);
    await waitFor(() => expect(screen.getByText('No recordings yet.')).toBeTruthy());
  });
});
