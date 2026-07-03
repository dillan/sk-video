import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Recordings } from './Recordings';

const SEG_START = 1_700_000_000_000;

const cam = {
  camera: 'bow',
  recording: true,
  startedAt: SEG_START,
  endedAt: SEG_START + 200_000,
  segments: [
    { name: 'bow_20260101_120000.mp4', startedAt: SEG_START, durationMs: 60_000, bytes: 5e6 },
  ],
  gaps: [{ startedAt: SEG_START + 100_000, endedAt: SEG_START + 200_000, durationMs: 100_000 }],
};

/** fetch mock: GET timeline returns the cameras; POST /incidents returns a new id. */
function mockApi(cameras: unknown[], onPost?: (body: unknown) => void) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST' && String(url).includes('/incidents')) {
        onPost?.(JSON.parse(init.body ?? '{}'));
        return Promise.resolve({ ok: true, json: async () => ({ id: 'inc-9' }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ generatedAt: 0, segmentSeconds: 60, cameras }),
      });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Recordings — DVR scrubber', () => {
  it('renders a per-camera track with segment and gap blocks and a recording badge', async () => {
    mockApi([cam]);
    render(<Recordings />);
    await waitFor(() => expect(screen.getByText('bow')).toBeTruthy());
    expect(screen.getByText('Recording')).toBeTruthy();
    expect(document.querySelector('.dvr__seg')).toBeTruthy(); // a recorded span
    expect(document.querySelector('.dvr__gap')).toBeTruthy(); // a neutral coverage gap
    expect(screen.getByRole('slider', { name: /Scrub bow/ })).toBeTruthy();
  });

  it('shows camera tabs for multiple cameras and switches the visible track', async () => {
    const stern = { ...cam, camera: 'stern' };
    mockApi([cam, stern]);
    render(<Recordings />);
    await waitFor(() => screen.getByRole('button', { name: 'bow' }));
    // Defaults to the first camera; only its track is shown.
    expect(screen.getByRole('slider', { name: /Scrub bow/ })).toBeTruthy();
    expect(screen.queryByRole('slider', { name: /Scrub stern/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'stern' }));
    await waitFor(() => expect(screen.getByRole('slider', { name: /Scrub stern/ })).toBeTruthy());
    expect(screen.queryByRole('slider', { name: /Scrub bow/ })).toBeNull();
  });

  it('scrubs with the keyboard, reveals a seeked player, and marks a retrospective incident', async () => {
    let posted: unknown = null;
    mockApi([cam], (b) => (posted = b));
    render(<Recordings />);
    const track = await waitFor(() => screen.getByRole('slider', { name: /Scrub bow/ }));

    // One ArrowRight step (1% of a 200s span = 2s) lands inside the segment → an inline player appears.
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(document.querySelector('video.vidrow__player')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Mark incident here/ }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ cameras: ['bow'], triggerAt: SEG_START + 2000 });
    await waitFor(() => expect(screen.getByText(/Incident marked/)).toBeTruthy());
  });

  it('disables Mark incident inside a coverage gap (nothing in the buffer to capture)', async () => {
    mockApi([cam]);
    render(<Recordings />);
    const track = await screen.findByRole('slider', { name: /Scrub bow/ });
    // Click at the far right of the track — inside the trailing gap.
    Object.defineProperty(track, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 100, top: 0, height: 10, right: 100, bottom: 10 }),
    });
    fireEvent.click(track, { clientX: 99 });
    await waitFor(() => expect(screen.getByText(/No coverage at this point/)).toBeTruthy());
    const mark = screen.getByRole('button', { name: 'Mark incident here' }) as HTMLButtonElement;
    expect(mark.disabled).toBe(true);
  });

  it('shows an honest empty state', async () => {
    mockApi([]);
    render(<Recordings />);
    await waitFor(() => expect(screen.getByText('No recordings yet.')).toBeTruthy());
  });
});
