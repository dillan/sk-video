import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTwoWayTalk } from './useTwoWayTalk';

afterEach(() => vi.restoreAllMocks());

describe('useTwoWayTalk', () => {
  it('starts not talking', () => {
    const { result } = renderHook(() => useTwoWayTalk('cam', vi.fn()));
    expect(result.current.talking).toBe(false);
    expect(result.current.connecting).toBe(false);
  });

  it('flashes an honest error when the browser can’t capture the mic (no WebRTC in jsdom)', () => {
    const flash = vi.fn();
    const { result } = renderHook(() => useTwoWayTalk('cam', flash));
    act(() => result.current.toggle());
    expect(flash).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/can’t capture the mic/i) }),
    );
    expect(result.current.talking).toBe(false);
  });
});
