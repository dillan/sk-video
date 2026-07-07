import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dragToVelocity,
  pinchToZoom,
  wheelToZoom,
  changedEnough,
  fingerDistance,
  type IPoint,
} from '../lib/ptz-gestures';

/**
 * Touch / trackpad PTZ gestures over a video surface, expressed as ONVIF continuousMove velocities.
 * One finger (or mouse) drags a joystick from its grab point: direction + distance set pan/tilt
 * speed, and lifting stops. Two fingers pinch to zoom. A wheel/trackpad tick is a brief zoom pulse.
 *
 * Velocity commands are throttled (a continuousMove holds until changed/stopped, so we only resend
 * when the vector meaningfully changes, and no faster than SEND_INTERVAL_MS). The server also arms a
 * runaway auto-stop, so a dropped "stop" still halts the camera. Attach the returned `setRef` to the
 * gesture surface; `active` + `vector` drive the on-screen joystick affordance.
 */

export interface IGestureVector {
  pan: number;
  tilt: number;
  zoom: number;
}

const ZERO: IGestureVector = { pan: 0, tilt: 0, zoom: 0 };
/** Minimum gap between continuousMove commands during a drag (≈7/s peak). */
const SEND_INTERVAL_MS = 140;
/** A wheel zoom pulse auto-stops this long after the last tick. */
const WHEEL_STOP_MS = 280;
/** Drag distance (px) that maps to full pan/tilt speed. */
const DRAG_RADIUS = 170;

export interface IPtzGestureApi {
  /** A drag/pinch is in progress (drives cursor + joystick visual). */
  active: boolean;
  /** The current commanded velocity while active (for the joystick knob), else null. */
  vector: IGestureVector | null;
  /** Callback ref to attach to the gesture surface element. */
  setRef: (el: HTMLElement | null) => void;
}

export function usePtzGestures(opts: {
  /** Continuous drag/pinch/wheel gestures (behind the "continuous PTZ" opt-in). */
  enabled: boolean;
  onMove: (v: IGestureVector) => void;
  onStop: () => void;
  /** Tap-to-aim: a short, stationary tap fires onTap with its client coords. Independent of `enabled`. */
  tapEnabled?: boolean;
  onTap?: (clientX: number, clientY: number) => void;
}): IPtzGestureApi {
  const { enabled } = opts;

  // Hold the latest callbacks in refs so the native listeners (bound once per enable) always call
  // through to current closures without re-binding on every render.
  const onMoveRef = useRef(opts.onMove);
  const onStopRef = useRef(opts.onStop);
  const onTapRef = useRef(opts.onTap);
  onMoveRef.current = opts.onMove;
  onStopRef.current = opts.onStop;
  onTapRef.current = opts.onTap;

  const elRef = useRef<HTMLElement | null>(null);
  const pts = useRef(new Map<number, IPoint>());
  const origin = useRef<IPoint | null>(null);
  const pinchStart = useRef<number | null>(null);
  const lastSent = useRef<{ t: number; v: IGestureVector }>({ t: 0, v: ZERO });
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelStop = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [active, setActive] = useState(false);
  const [vector, setVector] = useState<IGestureVector | null>(null);

  const clearFlush = () => {
    if (flush.current) {
      clearTimeout(flush.current);
      flush.current = null;
    }
  };

  // Send a velocity, throttled. Skip if the camera is already commanded this vector; otherwise send
  // now if enough time has passed, else schedule a single trailing send so the final vector lands.
  const emit = useCallback((v: IGestureVector) => {
    if (!changedEnough(lastSent.current.v, v)) return;
    const now = Date.now();
    if (now - lastSent.current.t >= SEND_INTERVAL_MS) {
      clearFlush();
      lastSent.current = { t: now, v };
      onMoveRef.current(v);
    } else if (!flush.current) {
      const wait = SEND_INTERVAL_MS - (now - lastSent.current.t);
      flush.current = setTimeout(() => {
        flush.current = null;
        lastSent.current = { t: Date.now(), v };
        onMoveRef.current(v);
      }, wait);
    }
  }, []);

  const endGesture = useCallback(() => {
    clearFlush();
    origin.current = null;
    pinchStart.current = null;
    pts.current.clear();
    lastSent.current = { t: 0, v: ZERO };
    setActive(false);
    setVector(null);
    onStopRef.current();
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !enabled) return;
    const points = pts.current; // stable Map we own; capture for the cleanup closure

    const down = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId);
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size === 1) {
        origin.current = { x: e.clientX, y: e.clientY };
        setActive(true);
        setVector(ZERO);
      } else if (pts.current.size === 2) {
        const [a, b] = [...pts.current.values()];
        pinchStart.current = fingerDistance(a, b);
        origin.current = null; // suspend pan while two fingers pinch
      }
    };

    const move = (e: PointerEvent) => {
      if (!pts.current.has(e.pointerId)) return;
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size >= 2 && pinchStart.current) {
        const [a, b] = [...pts.current.values()];
        const v = { ...ZERO, zoom: pinchToZoom(pinchStart.current, fingerDistance(a, b)) };
        setVector(v);
        emit(v);
        return;
      }
      if (origin.current) {
        const { pan, tilt } = dragToVelocity(
          e.clientX - origin.current.x,
          e.clientY - origin.current.y,
          DRAG_RADIUS,
        );
        const v = { pan, tilt, zoom: 0 };
        setVector(v);
        emit(v);
      }
    };

    const up = (e: PointerEvent) => {
      if (!pts.current.has(e.pointerId)) return;
      el.releasePointerCapture?.(e.pointerId);
      pts.current.delete(e.pointerId);
      if (pts.current.size === 0) {
        endGesture();
      } else if (pts.current.size === 1) {
        // Lifted one finger out of a pinch: stop zoom and resume panning from the finger that remains.
        pinchStart.current = null;
        const [p] = [...pts.current.values()];
        origin.current = { x: p.x, y: p.y };
        lastSent.current = { t: 0, v: ZERO };
        onMoveRef.current(ZERO);
        setVector(ZERO);
      }
    };

    const wheel = (e: WheelEvent) => {
      const zoom = wheelToZoom(e.deltaY);
      if (!zoom) return;
      e.preventDefault(); // keep the page from zooming/scrolling under a trackpad pinch
      const v = { ...ZERO, zoom };
      lastSent.current = { t: Date.now(), v };
      onMoveRef.current(v);
      setActive(true);
      setVector(v);
      if (wheelStop.current) clearTimeout(wheelStop.current);
      wheelStop.current = setTimeout(() => {
        wheelStop.current = null;
        endGesture();
      }, WHEEL_STOP_MS);
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      if (wheelStop.current) clearTimeout(wheelStop.current);
      // If the surface is torn down (or PTZ disabled) mid-gesture, make sure the camera is stopped.
      if (active || points.size) endGesture();
    };
    // `active` intentionally omitted: re-binding listeners on every drag tick would drop pointer
    // capture. The cleanup reads `active` via closure only at teardown, which is acceptable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, emit, endGesture]);

  const setRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  return { active, vector, setRef };
}
