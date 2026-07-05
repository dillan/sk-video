import { useCallback, useState } from 'react';

/**
 * A per-view list/grid preference. Collections (Videos, Incidents) can be shown as a thumbnail grid
 * or a labelled list; each view remembers the operator's last choice INDEPENDENTLY, keyed by view.
 * Persisted to localStorage so it's device-scoped — a phone and a nav-station laptop keep their own
 * preferences (a helm tablet may want the roomy grid while a desktop prefers the dense list). The
 * default is grid. Storage access is defensive: a privacy-mode throw just loses persistence.
 */
export const VIEW_MODES = ['grid', 'list'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value);
}

const key = (view: string): string => `sk-video.view.${view}`;

/** The persisted mode for a view, or 'grid' when none is stored / storage is unavailable. */
export function loadViewMode(
  view: string,
  storage: Pick<Storage, 'getItem'> = localStorage,
): ViewMode {
  try {
    const stored = storage.getItem(key(view));
    if (isViewMode(stored)) return stored;
  } catch {
    /* fall through to the default */
  }
  return 'grid';
}

/** Persist a view's mode (failures are swallowed). */
export function saveViewMode(
  view: string,
  mode: ViewMode,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(key(view), mode);
  } catch {
    /* best-effort */
  }
}

/** React state bound to a view's persisted list/grid preference. */
export function useViewMode(view: string): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => loadViewMode(view));
  const set = useCallback(
    (next: ViewMode) => {
      setMode(next);
      saveViewMode(view, next);
    },
    [view],
  );
  return [mode, set];
}
