/**
 * Theme is a value swap on a single `data-theme` attribute (the CSS does the rest via custom
 * properties), persisted to localStorage. Dark is the default — the design leads with Dark. Day is the
 * sunlit-helm light mode; Night-Red preserves dark adaptation at sea (red on near-black, no glow,
 * dimmed video). Across all themes the video always stays on the invariant near-black mat. Storage
 * access is defensive: a privacy-mode browser that throws on localStorage just loses persistence.
 */
export const THEMES = ['day', 'dark', 'night'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  day: 'Day',
  dark: 'Dark',
  night: 'Night-Red',
};

const STORAGE_KEY = 'sk-video.theme';
const DEFAULT_THEME: Theme = 'dark';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** The persisted theme, or the Dark default when none is stored / storage is unavailable. */
export function loadTheme(storage: Pick<Storage, 'getItem'> = localStorage): Theme {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Apply a theme to the document root and persist it (persistence failures are swallowed). */
export function applyTheme(
  theme: Theme,
  opts: { root?: HTMLElement; storage?: Pick<Storage, 'setItem'> } = {},
): void {
  (opts.root ?? document.documentElement).setAttribute('data-theme', theme);
  try {
    (opts.storage ?? localStorage).setItem(STORAGE_KEY, theme);
  } catch {
    /* persistence is best-effort; the attribute is what matters this session */
  }
}
