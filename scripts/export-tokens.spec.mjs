import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseThemeTokens, buildTokens } from './export-tokens.mjs';

const FIXTURE = `
/* comment with a { brace } */
:root,
[data-theme='dark'] {
  --accent: #2e9bff;
  --radius: 14px;
  color-scheme: dark;
}
[data-theme='night'] {
  --accent: #ff8159;
}
[data-theme='night'] .player__media {
  --not-a-token: from-a-descendant-rule;
  filter: brightness(0.4);
}
@media (prefers-reduced-transparency: reduce) {
  :root {
    --accent: #000000; /* conditional variant — must not leak into the base tokens */
  }
}
:root {
  --cx-txt: #dbe4ec;
  --grad: linear-gradient(160deg, #3aa5ff, #0b73e6);
}
`;

describe('parseThemeTokens', () => {
  const buckets = parseThemeTokens(FIXTURE);

  it('collects custom properties from grouped :root / theme selectors', () => {
    expect(buckets.root['--accent']).toBe('#2e9bff');
    expect(buckets.dark['--accent']).toBe('#2e9bff');
    expect(buckets.night['--accent']).toBe('#ff8159');
    expect(buckets.root['--radius']).toBe('14px');
  });

  it('merges a second :root block and keeps multi-part values intact', () => {
    expect(buckets.root['--cx-txt']).toBe('#dbe4ec');
    expect(buckets.root['--grad']).toBe('linear-gradient(160deg, #3aa5ff, #0b73e6)');
  });

  it('ignores non-custom-property declarations', () => {
    expect(Object.values(buckets.root)).not.toContain('dark');
  });

  it('skips descendant rules and @media-scoped blocks', () => {
    expect(buckets.night['--not-a-token']).toBeUndefined();
    expect(buckets.root['--accent']).toBe('#2e9bff'); // not the reduced-transparency override
  });
});

describe('buildTokens', () => {
  it('resolves each theme as base :root plus that theme’s overrides', () => {
    const doc = buildTokens(FIXTURE);
    expect(doc.generatedFrom).toBe('webapp/src/theme.css');
    expect(doc.themes.dark['--accent']).toBe('#2e9bff');
    expect(doc.themes.night['--accent']).toBe('#ff8159');
    expect(doc.themes.night['--radius']).toBe('14px'); // inherited from :root
    expect(doc.themes.day['--accent']).toBe('#2e9bff'); // no day override in the fixture
  });

  it('exports the real theme.css with all three themes and the night remaps applied', () => {
    const css = readFileSync(new URL('../webapp/src/theme.css', import.meta.url), 'utf8');
    const doc = buildTokens(css);
    expect(Object.keys(doc.themes).sort()).toEqual(['dark', 'day', 'night']);
    expect(doc.themes.dark['--accent']).toBe('#2e9bff');
    expect(doc.themes.day['--accent']).toBe('#0b73e6');
    expect(doc.themes.night['--accent']).toBe('#ff8159');
    // The floating-cluster tokens live on :root; night must override the blue ones.
    expect(doc.themes.dark['--cx-accent']).toBe('#2e9bff');
    expect(doc.themes.night['--cx-accent']).toBe('#ff8159');
    expect(doc.themes.night['--cx-txt']).not.toBe(doc.themes.dark['--cx-txt']);
  });
});
