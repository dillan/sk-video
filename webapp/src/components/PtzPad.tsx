import { createElement, useEffect, useRef } from 'react';
import './ptz-pad-variant';

/** The `ptz` CustomEvent detail dispatched by <ptz-pad-variant> (see ptz-pad-variant.ts). */
export interface IPtzDetail {
  type: 'pan' | 'panend' | 'step';
  x: number;
  y: number;
  dir?: 'up' | 'down' | 'left' | 'right';
}

interface Props {
  /** Square footprint in px; all pad geometry scales from it (88 phone · 100 tablet/desktop). */
  size: number;
  onPtz: (detail: IPtzDetail) => void;
}

/**
 * React wrapper around the framework-free <ptz-pad-variant> custom element: it just renders the
 * element and relays its `ptz` events. Keying the element by `size` remounts it on a size change so
 * the pad rebuilds its geometry (the element itself builds once, in connectedCallback).
 */
export function PtzPad({ size, onPtz }: Props) {
  const ref = useRef<HTMLElement | null>(null);
  const cb = useRef(onPtz);
  cb.current = onPtz;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event): void => cb.current((e as CustomEvent<IPtzDetail>).detail);
    el.addEventListener('ptz', handler);
    return () => el.removeEventListener('ptz', handler);
  }, []);

  return createElement('ptz-pad-variant', {
    ref,
    key: size,
    variant: 'glass',
    size: String(size),
  });
}
