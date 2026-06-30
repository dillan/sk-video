import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { usePtzGestures, type IGestureVector } from './usePtzGestures';

function Harness(props: {
  enabled: boolean;
  onMove: (v: IGestureVector) => void;
  onStop: () => void;
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
