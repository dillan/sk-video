import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contract tests over theme.css itself. jsdom doesn't lay out or cascade CSS, so these parse the
 * stylesheet and hold the theme system to its stated invariants:
 *  - Night-Red emits no blue-, green- or white-dominant light (dark adaptation at sea);
 *  - night caps the luminance of every video/snapshot surface, not just the live player;
 *  - prefers-reduced-transparency gets opaque glass with no backdrop blur;
 *  - the shell honours all four safe-area insets (notched devices in landscape).
 */

// Read from disk (not a `?raw` import — the config's `css: false` stubs those to ''). Vitest runs
// worker cwd at the webapp project root regardless of where the suite is invoked from.
const css = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

interface IBlock {
  selector: string;
  body: string;
  start: number;
}

/** Top-level rule blocks; an at-rule (@media/@keyframes) is one block with its nested body. */
function topBlocks(src: string): IBlock[] {
  const out: IBlock[] = [];
  let i = 0;
  for (;;) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const selector = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    out.push({ selector, body: src.slice(open + 1, j - 1), start: i });
    i = j;
  }
  return out;
}

const blocks = topBlocks(css);

/** Split a selector list on top-level commas only — `:is(a, b)` stays one part. */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());
  return parts;
}
const selectorParts = (b: IBlock): string[] => splitSelectorList(b.selector);
/** Every rule scoped to Night-Red (token blocks and component overrides alike). */
const nightBlocks = blocks.filter((b) =>
  selectorParts(b).every((s) => s.startsWith("[data-theme='night']")),
);
/** Pure night token blocks: `[data-theme='night'] { --… }` with no descendant part. */
const nightTokenBlocks = nightBlocks.filter((b) =>
  selectorParts(b).every((s) => s === "[data-theme='night']"),
);

function parseColor(literal: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(literal);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(literal);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

describe('Night-Red contract (no blue / green / white light)', () => {
  it('has night rules to inspect', () => {
    expect(nightBlocks.length).toBeGreaterThan(10);
  });

  it('every colour literal a night rule emits is red-dominant (near-blacks exempt)', () => {
    for (const b of nightBlocks) {
      // The LIVE badge keeps the app-wide white-on-red safety treatment by design.
      if (b.selector.includes('.livechip--on')) continue;
      const literals = b.body.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [];
      for (const lit of literals) {
        const rgb = parseColor(lit);
        if (!rgb) continue;
        const [r, g, bl] = rgb;
        if (Math.max(r, g, bl) <= 64) continue; // near-black: emits no meaningful light
        expect(r, `${lit} in "${b.selector}" is not red-dominant`).toBeGreaterThan(g);
        expect(r, `${lit} in "${b.selector}" is not red-dominant`).toBeGreaterThan(bl);
      }
    }
  });

  it('remaps every cool floating-cluster token, after the :root definition so the cascade wins', () => {
    const tokens = [
      '--cx-accent',
      '--cx-accent-txt',
      '--cx-accent-ico',
      '--cx-txt',
      '--cx-muted',
      '--cring',
      '--cglass',
      '--cglass-solid',
    ];
    for (const token of tokens) {
      const night = nightTokenBlocks.find((b) => b.body.includes(`${token}:`));
      expect(night, `${token} has no night remap`).toBeTruthy();
      const roots = blocks.filter(
        (b) => selectorParts(b).includes(':root') && b.body.includes(`${token}:`),
      );
      expect(roots.length, `${token} has no :root definition`).toBeGreaterThan(0);
      for (const root of roots) {
        expect(
          night!.start,
          `${token}: the night remap must come after :root or it loses the equal-specificity cascade`,
        ).toBeGreaterThan(root.start);
      }
    }
  });

  it('caps video luminance on the live player AND the review/snapshot surfaces', () => {
    const capped = nightBlocks.filter((b) => /brightness\(0\.4\)/.test(b.body));
    const selectors = capped.map((b) => b.selector).join('\n');
    expect(selectors).toContain('.player__media');
    expect(selectors).toContain('.vidrow__player');
    expect(selectors).toContain('.snap__img');
  });
});

describe('prefers-reduced-transparency contract', () => {
  const media = blocks.find((b) => b.selector.includes('prefers-reduced-transparency'));

  it('provides an opaque-glass block', () => {
    expect(media).toBeTruthy();
  });

  it('every glass token inside it is a fully opaque colour', () => {
    const glassDefs = media!.body.match(/--c?glass[\w-]*:\s*[^;]+/g) ?? [];
    expect(glassDefs.length).toBeGreaterThan(0);
    for (const def of glassDefs) {
      const value = def.slice(def.indexOf(':') + 1).trim();
      expect(value, `${def} is not opaque`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('drops backdrop blur (it does nothing over an opaque fill)', () => {
    expect(media!.body).toContain('backdrop-filter: none');
  });
});

describe('reduced-motion contract', () => {
  it('keeps the global animation/transition kill-switch', () => {
    const media = blocks.filter((b) => b.selector.includes('prefers-reduced-motion'));
    const all = media.map((b) => b.body).join('\n');
    expect(all).toContain('animation: none !important');
    expect(all).toContain('transition: none !important');
  });
});

describe('safe-area contract', () => {
  it('defines all four inset tokens from env()', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px)`);
    }
  });

  it('consumes every inset somewhere in the shell', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(`var(--safe-${side})`);
    }
  });
});
