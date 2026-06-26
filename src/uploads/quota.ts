/** Storage limits enforced before any upload is written. */
export interface IQuotaLimits {
  /** Largest single file allowed, in bytes. */
  maxFileBytes: number;
  /** Total bytes the plugin may use across all stored videos. */
  maxTotalBytes: number;
  /** Maximum number of stored videos. */
  maxFileCount: number;
}

/** Current storage usage. */
export interface IQuotaUsage {
  totalBytes: number;
  fileCount: number;
}

export type IQuotaResult = { ok: true } | { ok: false; reason: string };

/** Checks whether a new file of incomingBytes fits within the limits given current usage. */
export function checkQuota(
  usage: IQuotaUsage,
  incomingBytes: number,
  limits: IQuotaLimits,
): IQuotaResult {
  if (!Number.isFinite(incomingBytes) || incomingBytes <= 0) {
    return { ok: false, reason: 'empty file' };
  }
  if (incomingBytes > limits.maxFileBytes) {
    return { ok: false, reason: 'file too large' };
  }
  if (usage.fileCount + 1 > limits.maxFileCount) {
    return { ok: false, reason: 'too many files stored' };
  }
  if (usage.totalBytes + incomingBytes > limits.maxTotalBytes) {
    return { ok: false, reason: 'storage budget full' };
  }
  return { ok: true };
}
