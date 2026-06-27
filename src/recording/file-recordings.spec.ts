import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isValidSegmentName, scanRecordings } from './file-recordings';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sk-rec-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('isValidSegmentName', () => {
  it('accepts a recorder segment and rejects traversal / non-segments', () => {
    expect(isValidSegmentName('bow_20260627_143000.mp4')).toBe(true);
    expect(isValidSegmentName('../etc/passwd')).toBe(false);
    expect(isValidSegmentName('bow.mp4')).toBe(false);
    expect(isValidSegmentName('a/b_20260627_143000.mp4')).toBe(false);
  });
});

describe('scanRecordings', () => {
  it('indexes segment files (camera id + size) and ignores non-segments', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bow_20260627_143000.mp4'), 'aaaa');
    writeFileSync(join(dir, 'bow_20260627_143100.mp4'), 'bb');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const segments = scanRecordings(dir);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.cameraId === 'bow')).toBe(true);
    expect(segments.map((s) => s.bytes).sort()).toEqual([2, 4]);
  });

  it('returns [] for a missing directory', () => {
    expect(scanRecordings(join(tempDir(), 'nope'))).toEqual([]);
  });
});
