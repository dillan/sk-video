import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { CameraHealth } from './CameraHealth';
import { isHevc } from '../lib/transport';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(health: unknown, transport: unknown = { recommended: ['mjpeg'], codecs: [] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => (String(url).includes('/transport') ? ok(transport) : ok(health))),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('isHevc', () => {
  it('detects H.265 / HEVC codec names', () => {
    expect(isHevc(['H265'])).toBe(true);
    expect(isHevc(['hevc', 'PCMA'])).toBe(true);
    expect(isHevc(['H264'])).toBe(false);
    expect(isHevc([])).toBe(false);
  });
});

describe('CameraHealth', () => {
  it('shows the H.265 explanation when the stream is HEVC (the video-black diagnosis)', async () => {
    mockApi({ online: true, producers: 1, consumers: 1, codecs: ['H265'], sources: [] });
    render(<CameraHealth id="reolink" name="Foredeck" onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/H.265 \/ HEVC/)).toBeTruthy());
    expect(screen.getByText(/H.264 sub-stream/)).toBeTruthy();
    expect(screen.getByText('producing')).toBeTruthy();
  });

  it('reports an idle (lazy-connect) stream honestly, without an HEVC note', async () => {
    mockApi({ online: false, producers: 0, consumers: 0, codecs: [], sources: [] });
    render(<CameraHealth id="reolink" name="Foredeck" onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/idle — no active producer/)).toBeTruthy());
    expect(screen.queryByText(/HEVC/)).toBeNull();
  });
});
