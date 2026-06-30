import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { CameraTile } from './CameraTile';
import type { ICameraEntry } from '../api';

// jsdom has no RTCPeerConnection and no native HLS, so the player walks webrtc → hls → mjpeg and
// settles on the still-refresh <img> — which is enough to assert WHICH stream variant the tile asks for.
const player = () => document.querySelector('img.player__media');

const enabledSub: ICameraEntry = {
  id: 'reolink',
  name: 'Foredeck',
  enabled: true,
  capabilities: { substreams: true },
  media: { codec: 'h265', substreamPath: '/Preview_01_sub' },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CameraTile', () => {
  it('plays the H.264 sub-stream for an enabled camera and opens Focus on tap', async () => {
    const onOpen = vi.fn();
    render(<CameraTile camera={enabledSub} onOpen={onOpen} />);
    await waitFor(() => expect(player()).toBeTruthy());
    expect(player()!.getAttribute('src')).toContain('variant=sub');
    fireEvent.click(screen.getByRole('button', { name: /Foredeck/ }));
    expect(onOpen).toHaveBeenCalledWith('reolink');
  });

  it('plays the main stream for an enabled camera with no substream', async () => {
    render(<CameraTile camera={{ id: 'stern', name: 'Stern', enabled: true }} onOpen={vi.fn()} />);
    await waitFor(() => expect(player()).toBeTruthy());
    expect(player()!.getAttribute('src')).not.toContain('variant=sub');
  });

  it('shows a dimmed placeholder with no player for a disabled camera', () => {
    render(<CameraTile camera={{ id: 'off', name: 'Off', enabled: false }} onOpen={vi.fn()} />);
    expect(player()).toBeNull();
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(document.querySelector('.tile--dark')).toBeTruthy();
  });
});
