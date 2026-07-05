import type { ViewMode } from '../lib/view-mode';
import { GridIcon, ListIcon } from './icons';

/**
 * A small grid/list segmented control for a collection view. Purely presentational — the parent
 * owns the mode (via useViewMode) and persistence; this only reports switches. Clicking the active
 * mode is a no-op (no spurious writes/renders).
 */
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const pick = (next: ViewMode): void => {
    if (next !== mode) onChange(next);
  };
  return (
    <div className="viewtoggle" role="group" aria-label="View">
      <button
        type="button"
        className={`iconbtn${mode === 'grid' ? ' iconbtn--on' : ''}`}
        aria-pressed={mode === 'grid'}
        aria-label="Grid view"
        title="Grid view"
        onClick={() => pick('grid')}
      >
        <GridIcon width={18} height={18} />
      </button>
      <button
        type="button"
        className={`iconbtn${mode === 'list' ? ' iconbtn--on' : ''}`}
        aria-pressed={mode === 'list'}
        aria-label="List view"
        title="List view"
        onClick={() => pick('list')}
      >
        <ListIcon width={18} height={18} />
      </button>
    </div>
  );
}
