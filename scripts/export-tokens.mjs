#!/usr/bin/env node
/**
 * Exports the design tokens (CSS custom properties) from webapp/src/theme.css to public/tokens.json
 * so future non-CSS clients (smart-TV / native consoles) can consume the same palette. Only the
 * top-level `:root` and `[data-theme='…']` blocks are tokens — rules inside @media are conditional
 * variants and descendant selectors are component styling, so both are skipped. Each theme is the
 * base `:root` set with that theme's overrides applied, mirroring how the cascade resolves.
 *
 * Must run AFTER `vite build`: the webapp build empties public/ (outDir ../public, emptyOutDir), so
 * a tokens.json written first would be deleted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THEMES = ['dark', 'day', 'night'];

/**
 * Custom-property maps per top-level selector: { root: {...}, dark: {...}, day: {...}, night: {...} }.
 * A grouped selector (`:root, [data-theme='dark']`) contributes its declarations to every matching
 * bucket; later blocks for the same bucket override earlier ones, like the equal-specificity cascade.
 */
export function parseThemeTokens(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const buckets = { root: {}, dark: {}, day: {}, night: {} };
  let i = 0;
  for (;;) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const selector = src.slice(i, open).trim();
    // Walk to the matching close brace so @media/@keyframes bodies are skipped as one unit.
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') depth -= 1;
      j += 1;
    }
    const body = src.slice(open + 1, j - 1);
    i = j;
    if (selector.startsWith('@')) continue;
    const targets = [];
    for (const part of selector.split(',').map((s) => s.trim())) {
      if (part === ':root') targets.push('root');
      const theme = /^\[data-theme='(\w+)'\]$/.exec(part);
      if (theme && THEMES.includes(theme[1])) targets.push(theme[1]);
    }
    if (targets.length === 0) continue;
    for (const decl of body.split(';')) {
      const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
      if (!m) continue;
      const value = m[2].replace(/\s+/g, ' ');
      for (const t of targets) buckets[t][m[1]] = value;
    }
  }
  return buckets;
}

/** The tokens.json document: every theme fully resolved (base :root + theme overrides). */
export function buildTokens(css) {
  const buckets = parseThemeTokens(css);
  const themes = {};
  for (const t of THEMES) themes[t] = { ...buckets.root, ...buckets[t] };
  return { themes, generatedFrom: 'webapp/src/theme.css' };
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const cssPath = fileURLToPath(new URL('../webapp/src/theme.css', import.meta.url));
  const outPath = fileURLToPath(new URL('../public/tokens.json', import.meta.url));
  const doc = buildTokens(readFileSync(cssPath, 'utf8'));
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
  const counts = THEMES.map((t) => `${t}: ${Object.keys(doc.themes[t]).length}`).join(', ');
  console.log(`export-tokens: wrote public/tokens.json (${counts})`);
}
