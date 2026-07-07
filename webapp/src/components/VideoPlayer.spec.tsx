import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { VideoPlayer } from './VideoPlayer';

// In jsdom there's no RTCPeerConnection and no native HLS, so the walk naturally falls to MJPEG —
// which is exactly the "stranded on the 1 fps floor" state the recovery logic has to climb out of.

const src = (): string => document.querySelector('img.player__media')?.getAttribute('src') ?? '';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('VideoPlayer MJPEG cadence', () => {
  it('refreshes the still-image fast while `responsive` (PTZ active), not at the idle rate', () => {
    vi.useFakeTimers();
    render(<VideoPlayer cameraId="cam" transports={['mjpeg']} responsive />);
    const s0 = src();
    act(() => vi.advanceTimersByTime(250));
    expect(src()).not.toBe(s0); // boosted: a new frame within 250 ms
  });

  it('stays calm (~1 fps) when not driving a control', () => {
    vi.useFakeTimers();
    render(<VideoPlayer cameraId="cam" transports={['mjpeg']} />);
    const s0 = src();
    act(() => vi.advanceTimersByTime(250));
    expect(src()).toBe(s0); // idle: no refresh yet at 250 ms
    act(() => vi.advanceTimersByTime(1100));
    expect(src()).not.toBe(s0); // refreshes by the ~1.2 s idle cadence
  });

  it('stops transcoding (no still-refresh) while the document is hidden, and resumes when visible', () => {
    vi.useFakeTimers();
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    render(<VideoPlayer cameraId="cam" transports={['mjpeg']} />);
    const s0 = src();
    // Go hidden: a locked helm display shouldn't keep the Pi re-encoding a frame nobody sees.
    vis.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(5000));
    expect(src()).toBe(s0); // no refresh while hidden — the poster holds the last frame
    // Return to the app: the loop resumes.
    vis.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(1300));
    expect(src()).not.toBe(s0);
  });
});

describe('VideoPlayer recovers up to the preferred transport', () => {
  it('re-attempts the top rung on a backoff after being stranded on MJPEG', () => {
    vi.useFakeTimers();
    const rungs: string[] = [];
    render(
      <VideoPlayer
        cameraId="cam"
        transports={['webrtc', 'hls', 'mjpeg']}
        onRung={(r) => rungs.push(r)}
      />,
    );
    // Walked straight down to the MJPEG floor (no WebRTC/HLS support in jsdom).
    expect(rungs.at(-1)).toBe('mjpeg');
    rungs.length = 0;

    // After the first backoff it climbs back to the top rung to try again (then falls again here).
    act(() => vi.advanceTimersByTime(8000));
    expect(rungs).toContain('webrtc');
  });

  it('does not keep flapping forever — it gives up after the retry budget', () => {
    vi.useFakeTimers();
    const rungs: string[] = [];
    render(
      <VideoPlayer
        cameraId="cam"
        transports={['webrtc', 'hls', 'mjpeg']}
        onRung={(r) => rungs.push(r)}
      />,
    );
    // Effects (which schedule the next backoff) flush at act boundaries, so drive one attempt per act,
    // each advancing just past its growing delay (8s → 20s → 45s).
    let attempts = 0;
    for (const delay of [8100, 20100, 45100]) {
      rungs.length = 0;
      act(() => vi.advanceTimersByTime(delay));
      if (rungs.includes('webrtc')) attempts += 1;
    }
    expect(attempts).toBe(3); // it did retry, three times

    // Budget spent: no further re-attempts no matter how long we wait.
    rungs.length = 0;
    act(() => vi.advanceTimersByTime(120000));
    expect(rungs).not.toContain('webrtc');
  });
});
