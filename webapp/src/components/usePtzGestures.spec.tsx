import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { usePtzGestures, type IGestureVector } from './usePtzGestures';

function Harness(props: {
  enabled: boolean;
  onMove: (v: IGestureVector) => void;
  onStop: () => void;
  tapEnabled?: boolean;
  onTap?: (x: number, y: number) => void;
}) {
  const { setRef } = usePtzGestures(props);
  return <div data-testid="surface" ref={setRef} style={{ width: 400, height: 400 }} />;
}

const setup = (enabled = true) => {
  const onMove = vi.fn();
  const onStop = vi.fn();
  const { getByTestId } = render(<Harness enabled={enabled} onMove={onMove} onStop={onStop} />);
  return { el: getByTestId('surface'), onMove, onStop };
};

const setupTap = (over: { enabled?: boolean } = {}) => {
  const onMove = vi.fn();
  const onStop = vi.fn();
  const onTap = vi.fn();
  const { getByTestId } = render(
    <Harness
      enabled={over.enabled ?? false}
      tapEnabled
      onMove={onMove}
      onStop={onStop}
      onTap={onTap}
    />,
  );
  return { el: getByTestId('surface'), onMove, onStop, onTap };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('usePtzGestures', () => {
  it('drags right → pans right, and releasing stops', () => {
    const { el, onMove, onStop } = setup();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 360, clientY: 200 });
    expect(onMove).toHaveBeenCalled();
    const v = onMove.mock.calls.at(-1)![0] as IGestureVector;
    expect(v.pan).toBeGreaterThan(0);
    expect(Math.abs(v.tilt)).toBeLessThan(0.001);
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 360, clientY: 200 });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('drags up → tilts up', () => {
    const { el, onMove } = setup();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200, clientY: 40 });
    const v = onMove.mock.calls.at(-1)![0] as IGestureVector;
    expect(v.tilt).toBeGreaterThan(0);
  });

  it('a wheel tick zooms then auto-stops shortly after', () => {
    vi.useFakeTimers();
    const { el, onMove, onStop } = setup();
    fireEvent.wheel(el, { deltaY: -120 });
    expect((onMove.mock.calls.at(-1)![0] as IGestureVector).zoom).toBeGreaterThan(0);
    expect(onStop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('pinching two fingers apart zooms in', () => {
    const { el, onMove } = setup();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 180, clientY: 200 });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 220, clientY: 200 }); // start dist 40
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 360, clientY: 200 }); // dist 180 → spread
    const v = onMove.mock.calls.at(-1)![0] as IGestureVector;
    expect(v.zoom).toBeGreaterThan(0);
  });

  it('does nothing when PTZ gestures are disabled', () => {
    const { el, onMove, onStop } = setup(false);
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 360, clientY: 200 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 360, clientY: 200 });
    expect(onMove).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  describe('tap-to-aim', () => {
    it('a short, stationary tap fires onTap with the tap coordinates (continuous off)', () => {
      const { el, onTap, onMove, onStop } = setupTap();
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 260, clientY: 150 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 262, clientY: 151 }); // barely moved
      expect(onTap).toHaveBeenCalledTimes(1);
      expect(onTap).toHaveBeenCalledWith(260, 150); // the down point
      // Continuous is off, so no pan velocity / stop is dispatched.
      expect(onMove).not.toHaveBeenCalled();
      expect(onStop).not.toHaveBeenCalled();
    });

    it('a drag is NOT a tap (moved too far)', () => {
      const { el, onTap } = setupTap();
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 300, clientY: 200 }); // 100px
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 200 });
      expect(onTap).not.toHaveBeenCalled();
    });

    it('a long press is NOT a tap', () => {
      vi.useFakeTimers();
      const { el, onTap } = setupTap();
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200 });
      vi.advanceTimersByTime(600); // held well past the tap window
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 200, clientY: 200 });
      expect(onTap).not.toHaveBeenCalled();
    });

    it('a two-finger gesture is never a tap', () => {
      const { el, onTap } = setupTap();
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 180, clientY: 200 });
      fireEvent.pointerDown(el, { pointerId: 2, clientX: 220, clientY: 200 });
      fireEvent.pointerUp(el, { pointerId: 2, clientX: 220, clientY: 200 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 180, clientY: 200 });
      expect(onTap).not.toHaveBeenCalled();
    });

    it('taps aim while drags still pan when BOTH continuous and tap are enabled', () => {
      const { el, onTap, onMove, onStop } = setupTap({ enabled: true });
      // A tap → aim, no pan velocity AND no stop (a stop would race/cancel the aim move).
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 250, clientY: 250 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 250, clientY: 250 });
      expect(onTap).toHaveBeenCalledTimes(1);
      expect(onMove).not.toHaveBeenCalled();
      expect(onStop).not.toHaveBeenCalled();
      // A drag → pan (onMove), no aim.
      onTap.mockClear();
      fireEvent.pointerDown(el, { pointerId: 2, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(el, { pointerId: 2, clientX: 340, clientY: 200 });
      fireEvent.pointerUp(el, { pointerId: 2, clientX: 340, clientY: 200 });
      expect(onMove).toHaveBeenCalled();
      expect(onTap).not.toHaveBeenCalled();
    });
  });

  it('stops the camera if the surface unmounts mid-drag (runaway safety)', () => {
    const onMove = vi.fn();
    const onStop = vi.fn();
    const { getByTestId, unmount } = render(<Harness enabled onMove={onMove} onStop={onStop} />);
    const el = getByTestId('surface');
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 360, clientY: 200 });
    unmount();
    expect(onStop).toHaveBeenCalled();
  });
});
