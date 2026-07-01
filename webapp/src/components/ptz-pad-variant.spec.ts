import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import './ptz-pad-variant';

interface IPtzDetail {
  type: 'pan' | 'panend' | 'step';
  x: number;
  y: number;
  dir?: string;
}

function makePad(size = 168): HTMLElement {
  const el = document.createElement('ptz-pad-variant');
  el.setAttribute('variant', 'glass');
  el.setAttribute('size', String(size));
  document.body.appendChild(el);
  return el;
}

const pointer = (type: string, init: Partial<PointerEvent> = {}): Event => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 1, clientX: 0, clientY: 0, ...init });
  return e;
};

beforeAll(() => {
  expect(customElements.get('ptz-pad-variant')).toBeTruthy();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<ptz-pad-variant> (glass)', () => {
  it('builds a shadow DOM with a base, knob, four chevrons and a HUD', () => {
    const el = makePad();
    const root = el.shadowRoot!;
    expect(root).toBeTruthy();
    expect(root.querySelector('.base')).toBeTruthy();
    expect(root.querySelector('.knob')).toBeTruthy();
    expect(root.querySelector('.hud')).toBeTruthy();
    expect(root.querySelectorAll('.chev').length).toBe(4);
    expect([...root.querySelectorAll('.chev')].map((c) => (c as HTMLElement).dataset.dir)).toEqual([
      'up',
      'right',
      'down',
      'left',
    ]);
  });

  it('scales geometry from the size attribute (chevrons positioned inline)', () => {
    const el = makePad(100);
    // C = 50, CHEV_D = round(100 * 0.381) = 38 → up chevron centred at (50, 12).
    const up = el.shadowRoot!.querySelector('.chev[data-dir="up"]') as HTMLElement;
    expect(up.style.left).toBe('50px');
    expect(up.style.top).toBe('12px');
  });

  it('emits a clamped pan on drag and a panend on release, y positive = up', () => {
    const el = makePad(168); // MAX_R = round(168 * 0.1786) = 30
    const events: IPtzDetail[] = [];
    el.addEventListener('ptz', (e) => events.push((e as CustomEvent<IPtzDetail>).detail));
    const base = el.shadowRoot!.querySelector('.base') as HTMLElement;

    // getBoundingClientRect is 0×0 in jsdom, so the pointer offset is the client coord itself.
    base.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: -100 }));
    const pan = events.at(-1)!;
    expect(pan.type).toBe('pan');
    // Beyond MAX_R on both axes → clamped to the rim: components normalized to ≤1, up (−dy) positive.
    expect(Math.hypot(pan.x, pan.y)).toBeLessThanOrEqual(1.001);
    expect(pan.x).toBeGreaterThan(0);
    expect(pan.y).toBeGreaterThan(0);

    base.dispatchEvent(pointer('pointerup', {}));
    expect(events.at(-1)).toMatchObject({ type: 'panend', x: 0, y: 0 });
  });

  it('adds the live class while dragging and clears it on release', () => {
    const el = makePad();
    const base = el.shadowRoot!.querySelector('.base') as HTMLElement;
    const wrap = el.shadowRoot!.querySelector('.wrap') as HTMLElement;
    base.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
    expect(wrap.classList.contains('live')).toBe(true);
    base.dispatchEvent(pointer('pointerup', {}));
    expect(wrap.classList.contains('live')).toBe(false);
  });

  it('emits a directional step when a chevron is pressed', () => {
    const el = makePad();
    const events: IPtzDetail[] = [];
    el.addEventListener('ptz', (e) => events.push((e as CustomEvent<IPtzDetail>).detail));
    const up = el.shadowRoot!.querySelector('.chev[data-dir="up"]') as HTMLElement;
    up.dispatchEvent(pointer('pointerdown', {}));
    expect(events.at(-1)).toMatchObject({ type: 'step', dir: 'up', x: 0, y: 1 });
    up.dispatchEvent(pointer('pointerup', {}));
  });
});
