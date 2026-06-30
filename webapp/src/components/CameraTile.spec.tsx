import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { ICameraEntry } from '../api';

// Mock the media player so we can drive its onRung / onActive signals deterministically (real media
// playback never happens in jsdom). VideoPlayer's own URL/transport logic is covered elsewhere.
const h = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('./VideoPlayer', () => ({
  VideoPlayer: (props: Record<string, unknown>) => {
    h.last = props;
    return <div data-testid="player" />;
  },
}));

import { CameraTile } from './CameraTile';

const enabledSub: ICameraEntry = {
  id: 'reolink',
  name: 'Foredeck',
  enabled: true,
  capabilities: { substreams: true },
  media: { codec: 'h265', substreamPath: '/Preview_01_sub' },
};

const onActive = (a: boolean) => (h.last!.onActive as (x: boolean) => void)(a);
const onRung = (t: string) => (h.last!.onRung as (x: string) => void)(t);

afterEach(() => {
  cleanup();
  h.last = null;
  vi.useRealTimers();
});

describe('CameraTile', () => {
  it('plays the H.264 sub-stream for a camera with one and opens Focus on tap', () => {
    const onOpen = vi.fn();
    render(<CameraTile camera={enabledSub} onOpen={onOpen} />);
    expect(h.last!.variant).toBe('sub');
    fireEvent.click(screen.getByRole('button', { name: /Foredeck/ }));
    expect(onOpen).toHaveBeenCalledWith('reolink');
  });

  it('falls back to the main stream when the camera has no sub-stream', () => {
    render(<CameraTile camera={{ id: 'stern', name: 'Stern', enabled: true }} onOpen={vi.fn()} />);
    expect(h.last!.variant).toBe('main');
  });

  it('shows a dimmed placeholder with no player for a disabled camera', () => {
    render(<CameraTile camera={{ id: 'off', name: 'Off', enabled: false }} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('player')).toBeNull();
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(document.querySelector('.tile--dark')).toBeTruthy();
  });

  it('shows Live with the active transport once a frame is playing', () => {
    render(<CameraTile camera={enabledSub} onOpen={vi.fn()} />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    act(() => {
      onRung('webrtc');
      onActive(true);
    });
    const chip = document.querySelector('.chip--live');
    expect(chip?.textContent).toContain('Live');
    expect(chip?.textContent).toContain('WebRTC');
  });

  it('honestly reports No signal after the grace period with no frame', () => {
    vi.useFakeTimers();
    render(<CameraTile camera={enabledSub} onOpen={vi.fn()} />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    act(() => vi.advanceTimersByTime(10_500));
    expect(screen.getByText('No signal')).toBeTruthy();
  });
});
