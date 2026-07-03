#!/usr/bin/env node
/**
 * CI size budget for the web-app shell (plan §3): the WebRTC+MJPEG first paint must stay lean
 * because a Pi-class host serves it over marina wifi. The budget covers every eagerly-loaded
 * asset (public/assets/*.js + *.css); a lazy-loaded HLS rung (any chunk with "hls" in its name)
 * is exempt by design — it must never be pulled into first paint to pass this check.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 150 * 1024; // gzipped, JS+CSS shell total
const assetsDir = new URL('../public/assets/', import.meta.url).pathname;

let files;
try {
  files = readdirSync(assetsDir).filter((f) => /\.(js|css)$/.test(f));
} catch {
  console.error(`bundle-size: ${assetsDir} not found — run \`npm run build:webapp\` first`);
  process.exit(1);
}

let total = 0;
const rows = [];
for (const f of files.sort()) {
  const gz = gzipSync(readFileSync(join(assetsDir, f))).length;
  const lazyHls = /hls/i.test(f);
  if (!lazyHls) total += gz;
  rows.push(`${String(gz).padStart(8)}  ${f}${lazyHls ? '  (lazy hls — exempt)' : ''}`);
}

console.log(rows.join('\n'));
console.log(`${String(total).padStart(8)}  total (budget ${BUDGET_BYTES})`);
if (total > BUDGET_BYTES) {
  console.error(
    `bundle-size: shell is ${total} gz bytes, over the ${BUDGET_BYTES}-byte budget. ` +
      'Split the new code behind a lazy route/chunk or trim the dependency.',
  );
  process.exit(1);
}
