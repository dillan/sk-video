import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseSegmentName, type ISegment } from './recording-segments';

/** True for a safe recorder segment filename — gates playback against path traversal. */
export function isValidSegmentName(name: string): boolean {
  return !name.includes('/') && !name.includes('\\') && parseSegmentName(name) !== null;
}

/** Scans the recordings directory into a segment index (camera id from the name, time/size from stat). */
export function scanRecordings(dir: string): ISegment[] {
  if (!existsSync(dir)) {
    return [];
  }
  const segments: ISegment[] = [];
  for (const name of readdirSync(dir)) {
    const parsed = parseSegmentName(name);
    if (!parsed) {
      continue;
    }
    try {
      const stat = statSync(join(dir, name));
      segments.push({
        cameraId: parsed.cameraId,
        path: join(dir, name),
        startedAt: stat.mtimeMs,
        bytes: stat.size,
      });
    } catch {
      // a file that vanished mid-scan — ignore it
    }
  }
  return segments;
}
