import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from './atomic-write';

const dirs: string[] = [];
const freshDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'skv-atomic-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temp sibling behind', () => {
    const dir = freshDir();
    const path = join(dir, 'data.bin');
    writeFileAtomic(path, 'hello');
    expect(readFileSync(path, 'utf8')).toBe('hello');
    expect(readdirSync(dir)).toEqual(['data.bin']); // the temp file was renamed, not left
  });

  it('replaces existing content (and keeps the original until the rename commits)', () => {
    const dir = freshDir();
    const path = join(dir, 'data.bin');
    writeFileSync(path, 'old');
    writeFileAtomic(path, 'new');
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it('writes owner-only by default', () => {
    if (process.platform === 'win32') return;
    const dir = freshDir();
    const path = join(dir, 'secret');
    writeFileAtomic(path, 'x');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('writeJsonAtomic round-trips a pretty-printed object', () => {
    const dir = freshDir();
    const path = join(dir, 'data.json');
    writeJsonAtomic(path, { a: 1, b: [2, 3] });
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
  });
});
