/**
 * Density is the second display axis (orthogonal to theme): **Helm-glance** is roomy with large touch
 * targets for a moving helm; **Desk** is tighter for a chart-table desktop. Like theme it's a value swap
 * on a single `data-density` attribute (CSS does the rest) persisted to localStorage. With nothing
 * stored we default by device — Desk on a wide desktop, Helm-glance otherwise — but the operator's
 * choice always wins. Storage access is defensive (a privacy-mode throw just loses persistence).
 */
export const DENSITIES = ['helm', 'desk'] as const;
export type Density = (typeof DENSITIES)[number];

export const DENSITY_LABELS: Record<Density, string> = {
  helm: 'Helm',
  desk: 'Desk',
};

const STORAGE_KEY = 'sk-video.density';

export function isDensity(value: unknown): value is Density {
  return typeof value === 'string' && (DENSITIES as readonly string[]).includes(value);
}

/** A wide pointer-driven screen defaults to Desk; touch/narrow defaults to the roomy Helm-glance. */
function deviceDefault(): Density {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(min-width: 1024px)').matches) return 'desk';
    }
  } catch {
    /* matchMedia unavailable — fall through to Helm */
  }
  return 'helm';
}

/** The persisted density, or the device default when none is stored / storage is unavailable. */
export function loadDensity(storage: Pick<Storage, 'getItem'> = localStorage): Density {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (isDensity(stored)) return stored;
  } catch {
    /* fall through to the device default */
  }
  return deviceDefault();
}

/** Apply a density to the document root and persist it (persistence failures are swallowed). */
export function applyDensity(
  density: Density,
  opts: { root?: HTMLElement; storage?: Pick<Storage, 'setItem'> } = {},
): void {
  (opts.root ?? document.documentElement).setAttribute('data-density', density);
  try {
    (opts.storage ?? localStorage).setItem(STORAGE_KEY, density);
  } catch {
    /* best-effort */
  }
}
