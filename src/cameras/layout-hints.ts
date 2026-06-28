import type { ICamera } from './camera-validation';

/**
 * Pure layout/selection hints derived from the vessel-context camera model (F2). The plugin only
 * supplies STRUCTURED HINTS — the actual arrangement / quick-select UX lives in the separate KIP
 * widget. Each enabled camera is placed in a coarse spatial sector (from its mount bearing, else its
 * mount, else "unknown" — the sensible default bucket), grouped by role and sector, and offered as a
 * set of curated quick-select groups ("Forward" answers "show the foredeck") plus a suggested grid.
 */

export const LAYOUT_SECTORS = [
  'forward',
  'starboard',
  'aft',
  'port',
  'overhead',
  'interior',
  'unknown',
] as const;
export type TLayoutSector = (typeof LAYOUT_SECTORS)[number];

/** Coarse sector each mount sits in when no bearing is given. Bearing, when present, wins. */
const MOUNT_SECTOR: Record<string, TLayoutSector> = {
  bow: 'forward',
  deck: 'forward',
  stern: 'aft',
  transom: 'aft',
  cockpit: 'aft',
  helm: 'aft',
  port: 'port',
  starboard: 'starboard',
  mast: 'overhead',
  spreader: 'overhead',
  radararch: 'overhead',
  cabin: 'interior',
  interior: 'interior',
  engine: 'interior',
};

const DEFAULT_ROLE = 'general';

export interface ICameraLayoutEntry {
  id: string;
  name: string;
  role: string;
  mount: string | null;
  bearingRelativeDeg: number | null;
  sector: TLayoutSector;
  ptz: boolean;
  safetyCritical: boolean;
}

export interface ILayoutGroup {
  key: string;
  label: string;
  cameraIds: string[];
}

export interface ILayoutHints {
  /** Enabled cameras, ordered forward→aft→…, then by name — a sensible default arrangement order. */
  cameras: ICameraLayoutEntry[];
  byRole: Record<string, string[]>;
  bySector: Record<string, string[]>;
  /** Curated quick-select sets (only non-empty ones), e.g. "Forward", "PTZ", "Safety". */
  groups: ILayoutGroup[];
  /** A default grid shape for the camera count, for the widget to start from. */
  suggestedGrid: { rows: number; cols: number };
}

/** The spatial sector a camera sits in: bearing first (0=forward, clockwise), then mount, then unknown. */
export function sectorOf(camera: ICamera): TLayoutSector {
  const bearing = camera.placement?.bearingRelativeDeg;
  if (typeof bearing === 'number' && Number.isFinite(bearing)) {
    const n = ((bearing % 360) + 360) % 360;
    if (n >= 315 || n < 45) return 'forward';
    if (n < 135) return 'starboard';
    if (n < 225) return 'aft';
    return 'port';
  }
  const mount = camera.placement?.mount;
  return (mount && MOUNT_SECTOR[mount]) || 'unknown';
}

/** A near-square grid for `n` feeds: cols = ceil(sqrt(n)), rows = ceil(n/cols). */
export function suggestGrid(n: number): { rows: number; cols: number } {
  if (n <= 0) {
    return { rows: 0, cols: 0 };
  }
  const cols = Math.ceil(Math.sqrt(n));
  return { rows: Math.ceil(n / cols), cols };
}

const SECTOR_ORDER = new Map(LAYOUT_SECTORS.map((s, i) => [s, i]));

export function computeLayoutHints(cameras: Record<string, ICamera>): ILayoutHints {
  const entries: ICameraLayoutEntry[] = Object.entries(cameras)
    .filter(([, camera]) => camera.enabled)
    .map(([id, camera]) => ({
      id,
      name: camera.name,
      role: camera.role ?? DEFAULT_ROLE,
      mount: camera.placement?.mount ?? null,
      bearingRelativeDeg: camera.placement?.bearingRelativeDeg ?? null,
      sector: sectorOf(camera),
      ptz: camera.capabilities?.ptz === true || camera.capabilities?.absolutePtz === true,
      safetyCritical: camera.safetyCritical === true,
    }))
    .sort(
      (a, b) =>
        (SECTOR_ORDER.get(a.sector) ?? 99) - (SECTOR_ORDER.get(b.sector) ?? 99) ||
        a.name.localeCompare(b.name),
    );

  const byRole: Record<string, string[]> = {};
  const bySector: Record<string, string[]> = {};
  for (const e of entries) {
    (byRole[e.role] ??= []).push(e.id);
    (bySector[e.sector] ??= []).push(e.id);
  }

  const groups: ILayoutGroup[] = [];
  const add = (key: string, label: string, ids: string[]): void => {
    if (ids.length > 0) {
      groups.push({ key, label, cameraIds: ids });
    }
  };
  add(
    'all',
    'All cameras',
    entries.map((e) => e.id),
  );
  const SECTOR_LABEL: Record<TLayoutSector, string> = {
    forward: 'Forward',
    starboard: 'Starboard',
    aft: 'Aft',
    port: 'Port',
    overhead: 'Overhead',
    interior: 'Interior',
    unknown: 'Unplaced',
  };
  for (const sector of LAYOUT_SECTORS) {
    add(`sector:${sector}`, SECTOR_LABEL[sector], bySector[sector] ?? []);
  }
  add(
    'ptz',
    'PTZ cameras',
    entries.filter((e) => e.ptz).map((e) => e.id),
  );
  add(
    'safety',
    'Safety cameras',
    entries.filter((e) => e.safetyCritical).map((e) => e.id),
  );

  return { cameras: entries, byRole, bySector, groups, suggestedGrid: suggestGrid(entries.length) };
}
