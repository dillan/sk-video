import { Videos } from './Videos';
import { Recordings } from './Recordings';
import { Incidents } from './Incidents';
import { Snapshots } from './Snapshots';
import { Events } from './Events';

const TABS = [
  { key: 'recordings', label: 'Recordings' },
  { key: 'videos', label: 'Videos' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'events', label: 'Events' },
  { key: 'snapshots', label: 'Snapshots' },
] as const;

/**
 * The Library cluster shell: a sub-nav across everything the boat keeps (DVR recordings, uploaded
 * videos, incident bundles, the event feed, snapshots), driven by the route's optional id
 * (`#/library/videos`). Recordings is the default — the library is footage-first.
 */
export function Library({ tab, onTab }: { tab?: string; onTab: (t: string) => void }) {
  const active = TABS.some((t) => t.key === tab) ? (tab as string) : 'recordings';
  return (
    <div className="library">
      <nav className="seg library__tabs" aria-label="Library sections">
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
      {active === 'videos' && <Videos />}
      {active === 'incidents' && <Incidents />}
      {active === 'events' && <Events />}
      {active === 'snapshots' && <Snapshots />}
    </div>
  );
}
