import { ImportedVideos } from './ImportedVideos';
import { Recordings } from './Recordings';
import { Incidents } from './Incidents';
import { Snapshots } from './Snapshots';

const TABS = [
  { key: 'recordings', label: 'Recordings' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'snapshots', label: 'Snapshots' },
  { key: 'imported', label: 'Imported' },
] as const;

/**
 * The Review cluster shell: a sub-nav across the review surfaces (Recordings, Incidents, Imported),
 * driven by the route's optional id (`#/review/incidents`). Recordings is the default — review is
 * footage-first. Events + Snapshots arrive in later slices.
 */
export function Review({ tab, onTab }: { tab?: string; onTab: (t: string) => void }) {
  const active = TABS.some((t) => t.key === tab) ? (tab as string) : 'recordings';
  return (
    <div className="review">
      <nav className="seg review__tabs" aria-label="Review sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`iconbtn iconbtn--wide${active === t.key ? ' iconbtn--on' : ''}`}
            aria-pressed={active === t.key}
            onClick={() => onTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {active === 'recordings' && <Recordings />}
      {active === 'incidents' && <Incidents />}
      {active === 'snapshots' && <Snapshots />}
      {active === 'imported' && <ImportedVideos />}
    </div>
  );
}
