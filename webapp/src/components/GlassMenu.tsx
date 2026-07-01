import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A tap-to-open glass popover used by the vision, presets, stream and phone "…" clusters. Each menu
 * keeps its own open flag (opening one doesn't close another), rotates its trigger caret while open,
 * and dismisses on tap-away. The trigger is a render prop so every cluster styles its own chip.
 */

export interface IMenuRow {
  key: string;
  label: ReactNode;
  /** Optional mono sub-label (e.g. codec · resolution · latency). */
  sub?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** Optional status dot colour (stream connected-state). */
  dot?: string;
  onSelect: () => void;
}

interface Props {
  /** Renders the trigger chip. `open` drives the caret rotation; call `toggle` to open/close. */
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  rows: IMenuRow[];
  title?: string;
  /** Which edge the popover aligns to, and whether it opens upward (for bottom clusters). */
  align?: 'left' | 'right' | 'center';
  up?: boolean;
  /** Extra content above the rows (e.g. the phone "…" capability toggles). */
  footer?: ReactNode;
}

export function GlassMenu({ trigger, rows, title, align = 'left', up = false, footer }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  return (
    <div className="menu" ref={rootRef}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={`menu__pop menu__pop--${align}${up ? ' menu__pop--up' : ''}`} role="menu">
          {title && <div className="menu__title">{title}</div>}
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              role="menuitemradio"
              aria-checked={!!r.active}
              className={`menu__row${r.active ? ' menu__row--active' : ''}`}
              disabled={r.disabled}
              onClick={() => {
                if (r.disabled) return;
                r.onSelect();
                setOpen(false);
              }}
            >
              {r.dot !== undefined && <span className="menu__dot" style={{ background: r.dot }} />}
              <span className="menu__rowmain">
                <span className="menu__label">{r.label}</span>
                {r.sub && <span className="menu__sub mono">{r.sub}</span>}
              </span>
              {r.active && (
                <svg
                  className="menu__check"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  aria-hidden="true"
                >
                  <path d="M5 12l5 5 9-10" />
                </svg>
              )}
            </button>
          ))}
          {footer}
        </div>
      )}
    </div>
  );
}
