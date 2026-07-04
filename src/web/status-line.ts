/**
 * The one-line plugin status shown in the Signal K Dashboard / Plugin Config. Plugin status is a
 * single scalar string by design — per-camera state lives in the data model (cameras.<id>.*) — so
 * this line is the at-a-glance aggregate: how many cameras, how many currently producing video,
 * and whether any watched camera is dark.
 */
export function statusLine(summary: {
  cameras: number;
  streaming: number;
  dark: number;
  tier?: string;
}): string {
  const parts = [`Ready — ${summary.cameras} camera${summary.cameras === 1 ? '' : 's'}`];
  if (summary.cameras > 0) {
    parts.push(`${summary.streaming} streaming`);
  }
  if (summary.dark > 0) {
    parts.push(`${summary.dark} dark`);
  }
  if (summary.tier) {
    parts.push(summary.tier);
  }
  return parts.join(' · ');
}
