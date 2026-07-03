/**
 * <ptz-pad-variant> — a self-contained, framework-free camera pan/tilt controller: a drag joystick
 * (centre knob) combined with four cardinal chevron step buttons, in the "glass" theme (frameless,
 * near-invisible at rest, waking on interaction). Everything lives in a Shadow DOM and is inline-
 * styled; all geometry scales from the `size` attribute so one element serves phone/tablet/desktop.
 * Pointer Events make mouse and touch behave identically.
 *
 * Attributes: `size` (px footprint, default 168) · `variant` ("glass"; the only theme we ship).
 * Emits `ptz` CustomEvents ({bubbles, composed}): {type:'pan',x,y} while dragging (x,y ∈ −1…1, y+ up),
 * {type:'panend',x:0,y:0} on release, {type:'step',dir,x,y} for a chevron tap/hold.
 *
 * Ported from the design system's ptz-pad-variant reference (SK Video — Deference v2).
 */

/* Colours ride --ptz-* custom properties (they inherit through the shadow boundary), so Night-Red
 * can remap the cool blue/white glass onto its red ramp from theme.css; the literals are the
 * Dark/Day defaults. Ordinary theme selectors cannot reach into this shadow root. */
const GLASS = {
  font: "ui-monospace,'SF Mono',Menlo,monospace",
  letter: '.14em',
  ring: 'var(--ptz-ring, rgba(255,255,255,.09))',
  ringLive: 'var(--ptz-ring-live, rgba(190,214,240,.4))',
  glow: 'var(--ptz-glow, rgba(150,185,225,.34))',
  chev: 'var(--ptz-chev, rgba(222,232,244,.5))',
  accent: 'var(--ptz-accent, #c8def2)',
  knobA: 'rgba(64,78,94,.5)',
  knobB: 'rgba(16,22,30,.42)',
  nubA: 'var(--ptz-nub-a, #d2e2f2)',
  nubB: 'var(--ptz-nub-b, #8fa6bd)',
  nubHi: 'var(--ptz-nub-hi, #ffffff)',
  hud: 'var(--ptz-hud, rgba(206,220,236,.85))',
};

interface IGeom {
  S: number;
  C: number;
  MAX_R: number;
  CHEV_D: number;
  base: number;
  knob: number;
  chev: number;
  nub: number;
  chevSvg: number;
}

type TDir = 'up' | 'down' | 'left' | 'right';

const CHEV_VECTORS: Record<TDir, [number, number]> = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

class PtzPadVariant extends HTMLElement {
  private wired = false;
  private maxR = 0;
  private wrap!: HTMLDivElement;
  private base!: HTMLDivElement;
  private knob!: HTMLDivElement;
  private guide!: HTMLDivElement;
  private hud!: HTMLDivElement;
  private settle: ReturnType<typeof setTimeout> | undefined;

  connectedCallback(): void {
    if (this.wired) return;
    this.wired = true;
    this.build();
    this.wireJoystick();
    this.wireChevrons();
  }

  private geom(): IGeom {
    const S = Math.max(96, parseFloat(this.getAttribute('size') ?? '') || 168);
    return {
      S,
      C: S / 2,
      MAX_R: Math.round(S * 0.1786),
      CHEV_D: Math.round(S * 0.381),
      base: Math.round(S * 0.595),
      knob: Math.round(S * 0.333),
      chev: Math.round(S * 0.214),
      nub: Math.round(S * 0.078),
      chevSvg: Math.round(S * 0.101),
    };
  }

  private build(): void {
    const t = GLASS;
    const g = this.geom();
    this.maxR = g.MAX_R;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });

    const chevs: { dir: TDir; x: number; y: number; path: string }[] = [
      { dir: 'up', x: g.C, y: g.C - g.CHEV_D, path: 'M5 14l7-7 7 7' },
      { dir: 'right', x: g.C + g.CHEV_D, y: g.C, path: 'M9 5l7 7-7 7' },
      { dir: 'down', x: g.C, y: g.C + g.CHEV_D, path: 'M5 10l7 7 7-7' },
      { dir: 'left', x: g.C - g.CHEV_D, y: g.C, path: 'M15 5l-7 7 7 7' },
    ];
    const chevHTML = chevs
      .map(
        (c) => `
        <button class="chev" data-dir="${c.dir}" style="left:${c.x}px;top:${c.y}px" aria-label="Step ${c.dir}">
          <svg width="${g.chevSvg}" height="${g.chevSvg}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${c.path}"/></svg>
        </button>`,
      )
      .join('');

    const hudFont = Math.max(8, Math.round(g.S * 0.057));

    root.innerHTML = `
      <style>
        :host{display:block;width:${g.S}px;height:${g.S}px;font-family:${t.font};
          touch-action:none;-webkit-user-select:none;user-select:none;}
        .wrap{position:relative;width:${g.S}px;height:${g.S}px;}
        .base{position:absolute;left:50%;top:50%;width:${g.base}px;height:${g.base}px;
          transform:translate(-50%,-50%);border-radius:50%;cursor:grab;
          background:radial-gradient(120% 120% at 50% 30%,rgba(255,255,255,.05),rgba(255,255,255,.01) 72%);
          box-shadow:inset 0 0 0 1px ${t.ring},inset 0 14px 28px rgba(0,0,0,.45),0 6px 20px rgba(0,0,0,.42);
          transition:box-shadow .2s ease;}
        .wrap.live .base{cursor:grabbing;
          box-shadow:inset 0 0 0 1px ${t.ringLive},inset 0 14px 28px rgba(0,0,0,.45),0 0 24px ${t.glow};}
        .guide{position:absolute;left:50%;top:50%;width:${g.MAX_R * 2}px;height:${g.MAX_R * 2}px;
          transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;
          border:1px dashed ${t.ring};opacity:0;transition:opacity .2s ease;}
        .guide.show{opacity:1;}
        .knob{position:absolute;left:50%;top:50%;width:${g.knob}px;height:${g.knob}px;
          margin:-${g.knob / 2}px 0 0 -${g.knob / 2}px;border-radius:50%;pointer-events:none;
          background:radial-gradient(130% 130% at 50% 26%,${t.knobA},${t.knobB} 80%);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.20),inset 0 -7px 13px rgba(0,0,0,.5),0 8px 18px rgba(0,0,0,.5);
          display:flex;align-items:center;justify-content:center;
          transition:transform .28s cubic-bezier(.22,1,.36,1),box-shadow .2s ease;}
        .knob.live{transition:box-shadow .2s ease;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.28),inset 0 -7px 13px rgba(0,0,0,.5),0 8px 20px rgba(0,0,0,.55),0 0 18px ${t.glow};}
        .nub{width:${g.nub}px;height:${g.nub}px;border-radius:50%;
          background:radial-gradient(120% 120% at 50% 28%,${t.nubA},${t.nubB});
          box-shadow:inset 0 1px 1px rgba(255,255,255,.5),0 1px 2px rgba(0,0,0,.5);transition:background .16s ease;}
        .knob.live .nub{background:radial-gradient(120% 120% at 50% 28%,${t.nubHi},${t.accent});}
        .chev{position:absolute;width:${g.chev}px;height:${g.chev}px;margin:-${g.chev / 2}px 0 0 -${g.chev / 2}px;
          border:none;padding:0;border-radius:50%;cursor:pointer;color:${t.chev};background:transparent;
          box-shadow:none;display:flex;align-items:center;justify-content:center;
          transition:background .14s ease,color .14s ease,transform .14s ease,box-shadow .14s ease;}
        .chev:hover{color:${t.accent};background:rgba(255,255,255,.05);}
        .chev.press{background:rgba(255,255,255,.08);color:${t.accent};
          transform:scale(.88);box-shadow:0 0 16px ${t.glow},inset 0 0 0 1px ${t.ringLive};}
        .hud{position:absolute;left:50%;bottom:-4px;transform:translateX(-50%);
          font-size:${hudFont}px;letter-spacing:${t.letter};color:${t.hud};
          white-space:nowrap;background:rgba(6,10,16,.66);padding:2px 8px;border-radius:6px;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);opacity:0;transition:opacity .2s ease;
          pointer-events:none;text-transform:uppercase;}
        .hud.show{opacity:1;}
        /* The document-level reduced-motion/-transparency guards don't pierce the shadow boundary,
         * so this style block carries its own. */
        @media (prefers-reduced-motion: reduce){
          .base,.guide,.knob,.nub,.chev,.hud{transition:none !important;}
        }
        @media (prefers-reduced-transparency: reduce){
          .hud{background:rgb(6,10,16);}
        }
      </style>
      <div class="wrap">
        ${chevHTML}
        <div class="base"></div>
        <div class="guide"></div>
        <div class="knob"><span class="nub"></span></div>
        <div class="hud">Pan 0&nbsp;&nbsp;Tilt 0</div>
      </div>`;

    this.wrap = root.querySelector('.wrap') as HTMLDivElement;
    this.base = root.querySelector('.base') as HTMLDivElement;
    this.knob = root.querySelector('.knob') as HTMLDivElement;
    this.guide = root.querySelector('.guide') as HTMLDivElement;
    this.hud = root.querySelector('.hud') as HTMLDivElement;
  }

  private setKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate(${dx}px,${dy}px)`;
  }

  private emit(detail: {
    type: 'pan' | 'panend' | 'step';
    x: number;
    y: number;
    dir?: TDir;
  }): void {
    this.dispatchEvent(new CustomEvent('ptz', { bubbles: true, composed: true, detail }));
  }

  private wireJoystick(): void {
    const MAX_R = this.maxR;
    let id: number | null = null;
    const center = (): { x: number; y: number } => {
      const r = this.base.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const clamp = (dx: number, dy: number): [number, number] => {
      const d = Math.hypot(dx, dy);
      if (d > MAX_R) {
        const k = MAX_R / d;
        return [dx * k, dy * k];
      }
      return [dx, dy];
    };
    const move = (e: PointerEvent): void => {
      if (id === null || e.pointerId !== id) return;
      const c = center();
      const [dx, dy] = clamp(e.clientX - c.x, e.clientY - c.y);
      this.knob.style.transition = 'box-shadow .2s ease'; // 1:1 tracking, no position easing
      this.setKnob(dx, dy);
      const p = Math.round((dx / MAX_R) * 100);
      const tlt = Math.round((-dy / MAX_R) * 100);
      this.hud.textContent = `Pan ${p > 0 ? '+' : ''}${p}\u2002Tilt ${tlt > 0 ? '+' : ''}${tlt}`;
      this.emit({ type: 'pan', x: +(dx / MAX_R).toFixed(3), y: +(-dy / MAX_R).toFixed(3) });
    };
    const end = (e: PointerEvent): void => {
      if (id === null || e.pointerId !== id) return;
      id = null;
      this.wrap.classList.remove('live');
      this.knob.classList.remove('live');
      this.guide.classList.remove('show');
      this.hud.classList.remove('show');
      this.knob.style.transition = 'transform .28s cubic-bezier(.22,1,.36,1),box-shadow .2s ease';
      this.setKnob(0, 0);
      this.emit({ type: 'panend', x: 0, y: 0 });
    };
    this.base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      try {
        this.base.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom / unsupported */
      }
      this.wrap.classList.add('live');
      this.knob.classList.add('live');
      this.guide.classList.add('show');
      this.hud.classList.add('show');
      move(e);
    });
    this.base.addEventListener('pointermove', move);
    this.base.addEventListener('pointerup', end);
    this.base.addEventListener('pointercancel', end);
    this.base.addEventListener('lostpointercapture', end);
  }

  private wireChevrons(): void {
    const nudge = Math.round(this.maxR * 0.4);
    this.shadowRoot?.querySelectorAll<HTMLButtonElement>('.chev').forEach((btn) => {
      const dir = btn.dataset.dir as TDir;
      let hold: number | null = null;
      let rep: ReturnType<typeof setInterval> | undefined;
      let delay: ReturnType<typeof setTimeout> | undefined;
      const step = (): void => {
        const [sx, sy] = CHEV_VECTORS[dir];
        this.knob.style.transition = 'transform .09s ease-out';
        this.setKnob(sx * nudge, -sy * nudge);
        clearTimeout(this.settle);
        this.settle = setTimeout(() => {
          this.knob.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1)';
          this.setKnob(0, 0);
        }, 110);
        this.emit({ type: 'step', dir, x: sx, y: sy });
      };
      const press = (e: PointerEvent): void => {
        e.preventDefault();
        hold = e.pointerId;
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          /* jsdom / unsupported */
        }
        btn.classList.add('press');
        step();
        delay = setTimeout(() => {
          rep = setInterval(step, 170);
        }, 420);
      };
      const release = (e: PointerEvent): void => {
        if (hold !== null && e.pointerId !== hold) return;
        hold = null;
        btn.classList.remove('press');
        clearTimeout(delay);
        clearInterval(rep);
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }
}

if (!customElements.get('ptz-pad-variant')) {
  customElements.define('ptz-pad-variant', PtzPadVariant);
}

export {};
