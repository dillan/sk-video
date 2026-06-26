import { describe, it, expect } from 'vitest';
import { checkQuota, type IQuotaLimits } from './quota';

const LIMITS: IQuotaLimits = {
  maxFileBytes: 1000,
  maxTotalBytes: 5000,
  maxFileCount: 3,
};

describe('checkQuota', () => {
  it('allows a file that fits within every limit', () => {
    expect(checkQuota({ totalBytes: 1000, fileCount: 1 }, 500, LIMITS)).toEqual({ ok: true });
  });

  it('rejects an empty file', () => {
    expect(checkQuota({ totalBytes: 0, fileCount: 0 }, 0, LIMITS).ok).toBe(false);
  });

  it('rejects a file over the per-file cap', () => {
    const r = checkQuota({ totalBytes: 0, fileCount: 0 }, 1001, LIMITS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });

  it('rejects when the file count cap is reached', () => {
    const r = checkQuota({ totalBytes: 100, fileCount: 3 }, 100, LIMITS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too many/i);
  });

  it('rejects when the total budget would be exceeded', () => {
    const r = checkQuota({ totalBytes: 4800, fileCount: 1 }, 500, LIMITS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/storage|budget|full/i);
  });
});
