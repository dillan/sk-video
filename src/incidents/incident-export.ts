import AdmZip from 'adm-zip';
import { sanitizeFilename } from '../uploads/asset-store';
import type { IIncidentBundle, IIncidentAsset } from './incident-validation';

/** Map an asset kind to its folder inside the export. */
const KIND_FOLDER: Record<IIncidentAsset['kind'], string> = {
  clip: 'clips',
  snapshot: 'snapshots',
  telemetry: 'telemetry',
};

/** Read an asset's bytes by id, or null when the blob is missing/unreadable. */
export type AssetReader = (assetId: string) => Buffer | null;

function fmtMs(ms: number): string {
  // ISO is unambiguous across timezones; the export is shared evidence, not a helm display.
  return new Date(ms).toISOString();
}

/** The honesty-ledger README that travels with every export — verbatim posture from capabilities.md. */
function buildReadme(bundle: IIncidentBundle, skipped: IIncidentAsset[]): string {
  // null = omit an optional line entirely; '' = an intentional blank separator (kept).
  const lines: (string | null)[] = [
    `SK Video — incident export`,
    `Incident:  ${bundle.id}`,
    bundle.label ? `Label:     ${bundle.label}` : null,
    `Status:    ${bundle.status}`,
    `Triggered: ${fmtMs(bundle.trigger?.firedAt ?? bundle.createdAt)} (${bundle.trigger?.source ?? 'unknown'})`,
    `Window:    requested ${bundle.window?.preMs ?? 0} ms before … ${bundle.window?.postMs ?? 0} ms after the trigger`,
    `Cameras:   ${(bundle.cameras ?? []).join(', ') || '(none)'}`,
    bundle.notes ? `Notes:     ${bundle.notes}` : null,
    ``,
    `What this is`,
    `------------`,
    `This is BEST-EFFORT evidence captured by an operator console — NOT a certified VDR`,
    `and NOT a continuous surveillance recording. It is "share what was captured", nothing more.`,
    ``,
    `The sha256 values in manifest.json are a file integrity check (the bytes here match what`,
    `was captured) — they are NOT a chain-of-custody guarantee.`,
    ``,
    `Telemetry is FORWARD-ONLY from the trigger moment; it does not cover the pre-roll window.`,
    `When there was no GPS fix, the telemetry says so rather than guessing a position.`,
  ];

  const failures = bundle.failures ?? [];
  if (bundle.status === 'partial' || failures.length > 0) {
    lines.push(
      ``,
      `PARTIAL coverage`,
      `----------------`,
      `Some cameras did not capture. This is shown, never hidden:`,
      ...failures.map((f) => `  - ${f.cameraId ?? 'telemetry'} (${f.kind}): ${f.reason}`),
    );
  }
  if (skipped.length > 0) {
    lines.push(
      ``,
      `Assets that could not be read at export time (the blob was missing):`,
      ...skipped.map((a) => `  - ${a.kind} ${a.name} [${a.id}]`),
    );
  }
  lines.push(``);
  return lines.filter((l): l is string => l !== null).join('\n') + '\n';
}

/**
 * Builds a shareable .zip for one incident bundle: the manifest, an honesty README, and every asset
 * blob the reader can supply, foldered by kind. Missing blobs are skipped (best-effort, never abort)
 * and surfaced in both the README and the returned `skipped` list. Entry names are sanitized and
 * de-duplicated so no asset silently overwrites another. Pure: all disk access is via `readAsset`.
 */
export function buildIncidentZip(
  bundle: IIncidentBundle,
  readAsset: AssetReader,
): { buffer: Buffer; skipped: string[] } {
  const zip = new AdmZip();
  const skipped: IIncidentAsset[] = [];
  const used = new Set<string>();

  for (const asset of bundle.assets ?? []) {
    const bytes = readAsset(asset.id);
    if (!bytes) {
      skipped.push(asset);
      continue;
    }
    const folder = KIND_FOLDER[asset.kind] ?? 'other';
    let entry = `${folder}/${sanitizeFilename(asset.name)}`;
    if (used.has(entry)) entry = `${folder}/${asset.id}-${sanitizeFilename(asset.name)}`;
    used.add(entry);
    zip.addFile(entry, bytes);
  }

  zip.addFile('manifest.json', Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'));
  zip.addFile('README.txt', Buffer.from(buildReadme(bundle, skipped), 'utf8'));

  return { buffer: zip.toBuffer(), skipped: skipped.map((a) => a.id) };
}
