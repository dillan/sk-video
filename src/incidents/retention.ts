/**
 * Pure incident retention, mirroring recording-segments.ts segmentsToPrune but with a HARD
 * pinned-exclusion so flagged evidence is never auto-deleted. Bounds the incidents subtree
 * independently of the user-upload and DVR budgets, oldest-first across bytes, count and age.
 */

export interface IBundleQuota {
  maxBytes: number;
  maxCount: number;
  maxAgeMs: number;
}

export interface IBundleSummary {
  id: string;
  createdAt: number;
  totalBytes: number;
  pinned: boolean;
}

/** Ids of bundles to delete to satisfy the quota (oldest first). Pinned bundles are never returned. */
export function bundlesToPrune(
  bundles: IBundleSummary[],
  limits: IBundleQuota,
  now: number,
): string[] {
  const oldestFirst = [...bundles].sort((a, b) => a.createdAt - b.createdAt);
  const prune = new Set<string>();
  const prunable = (b: IBundleSummary): boolean => !b.pinned && !prune.has(b.id);

  // Age first.
  for (const b of oldestFirst) {
    if (prunable(b) && now - b.createdAt > limits.maxAgeMs) {
      prune.add(b.id);
    }
  }

  // Count next: drop oldest prunable until the surviving count is within budget.
  let count = oldestFirst.filter((b) => !prune.has(b.id)).length;
  for (const b of oldestFirst) {
    if (count <= limits.maxCount) {
      break;
    }
    if (prunable(b)) {
      prune.add(b.id);
      count -= 1;
    }
  }

  // Bytes last: drop oldest prunable until the surviving total is within budget.
  let total = oldestFirst.filter((b) => !prune.has(b.id)).reduce((sum, b) => sum + b.totalBytes, 0);
  for (const b of oldestFirst) {
    if (total <= limits.maxBytes) {
      break;
    }
    if (prunable(b)) {
      prune.add(b.id);
      total -= b.totalBytes;
    }
  }

  return [...prune];
}
