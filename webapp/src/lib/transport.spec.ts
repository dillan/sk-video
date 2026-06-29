import { describe, it, expect } from 'vitest';
import { pickTransport, nextTransport, transportLabel, ptzDelayed } from './transport';

describe('transport walk', () => {
  it('picks the first recommended rung (and defaults to mjpeg when empty)', () => {
    expect(pickTransport(['webrtc', 'hls', 'mjpeg'])).toBe('webrtc');
    expect(pickTransport([])).toBe('mjpeg');
  });
  it('falls back down the walk and stops at the end', () => {
    const walk = ['webrtc', 'hls', 'mjpeg'] as const;
    expect(nextTransport([...walk], 'webrtc')).toBe('hls');
    expect(nextTransport([...walk], 'hls')).toBe('mjpeg');
    expect(nextTransport([...walk], 'mjpeg')).toBeNull();
  });
  it('labels rungs and flags delayed PTZ on the still-refresh rung', () => {
    expect(transportLabel('webrtc')).toBe('WebRTC');
    expect(transportLabel('mjpeg')).toMatch(/still-refresh/);
    expect(ptzDelayed('mjpeg')).toBe(true);
    expect(ptzDelayed('webrtc')).toBe(false);
  });
});
