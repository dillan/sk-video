import { useCallback, useEffect, useState } from 'react';
import { fetchEvents, fetchStatus, type ILoggedEvent, type IPluginStatus } from '../api';

const PAGE = 100;

type Severity = 'alarm' | 'caution' | 'neutral';

interface IEventView {
  icon: string;
  label: string;
  /** True for Frigate rows, which get an honest close-range caveat. */
  frigate: boolean;
  severity: Severity;
  /** Hash route to the event's artifact, when one exists to open. */
  href: string | null;
}

/** Turn a raw notification key + state into a human row: label, icon, severity, and artifact link. */
function describeEvent(ev: ILoggedEvent): IEventView {
  const state = (ev.state ?? '').toLowerCase();
  const severity: Severity =
    state === 'emergency' || state === 'alarm'
      ? 'alarm'
      : state === 'alert' || state === 'warn' || state === 'warning'
        ? 'caution'
        : 'neutral';

  // Current rows use camera-path keys (`cameras.<id>.feedOutage`); the legacy pattern keeps
  // rows logged by older releases humanised — the event log is durable.
  const offline =
    /^cameras\.(.+)\.feedOutage$/.exec(ev.type) ?? /^camera\.(.+)\.offline$/.exec(ev.type);
  if (ev.type === 'mob' || ev.type.startsWith('mob.')) {
    return { icon: '🆘', label: 'Man overboard', frigate: false, severity, href: '#/safety' };
  }
  if (offline) {
    return {
      icon: '📷',
      label: `Camera offline · ${offline[1]}`,
      frigate: false,
      severity,
      href: `#/live/${encodeURIComponent(offline[1])}`,
    };
  }
  if (/^incident/.test(ev.type)) {
    return {
      icon: '🎬',
      label: 'Incident',
      frigate: false,
      severity,
      href: '#/library/incidents',
    };
  }
  if (/^anchor/.test(ev.type)) {
    return { icon: '⚓', label: 'Anchor watch', frigate: false, severity, href: '#/live' };
  }
  if (/^frigate/.test(ev.type)) {
    // No clip browser by design (close-range notifications only), so there is no artifact to open.
    return { icon: '👁', label: 'Frigate detection', frigate: true, severity, href: null };
  }
  return { icon: '•', label: ev.type, frigate: false, severity, href: null };
}

const chipClass: Record<Severity, string> = {
  alarm: 'chip chip--alarm',
  caution: 'chip chip--caution',
  neutral: 'chip chip--neutral',
};

/** The type-prefix filters; each maps to the server's `?type=` param (null = everything). */
const FILTERS: Array<{ key: string; label: string; type: string | null }> = [
  { key: 'all', label: 'All', type: null },
  { key: 'mob', label: 'MOB', type: 'mob' },
  { key: 'anchor', label: 'Anchor', type: 'anchor' },
  { key: 'camera', label: 'Cameras', type: 'cameras' },
  { key: 'incident', label: 'Incidents', type: 'incident' },
  { key: 'frigate', label: 'Frigate', type: 'frigate' },
];

/**
 * The Library cluster's Events tab: the durable activity feed (MOB, incidents, anchor drag, cameras
 * going dark). It's the retrospective record the live notification stream can't be — notifications
 * vanish on clear, this log doesn't. Honest about its bounds (best-effort, oldest rows roll off past
 * the cap) and about Frigate: those rows are close-range detections from a user-run Frigate, and an
 * empty feed with Frigate unconfigured means "not wired", never "nothing happened".
 */
export function Events() {
  const [events, setEvents] = useState<ILoggedEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [frigate, setFrigate] = useState<IPluginStatus['frigate']>();

  const type = FILTERS.find((f) => f.key === filter)?.type ?? null;

  useEffect(() => {
    const ctrl = new AbortController();
    setLoaded(false);
    setEnded(false);
    fetchEvents({ limit: PAGE, ...(type ? { type } : {}) }, ctrl.signal)
      .then((rows) => {
        setEvents(rows);
        setEnded(rows.length === 0);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : 'unreachable');
      });
    return () => ctrl.abort();
  }, [type]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchStatus(ctrl.signal)
      .then((s) => setFrigate(s.frigate))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const loadOlder = useCallback(() => {
    if (busy || events.length === 0) return;
    setBusy(true);
    const before = events[events.length - 1].at;
    fetchEvents({ limit: PAGE, before, ...(type ? { type } : {}) })
      .then((rows) => {
        setEvents((prev) => [...prev, ...rows]);
        if (rows.length === 0) setEnded(true);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'unreachable'))
      .finally(() => setBusy(false));
  }, [busy, events, type]);

  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <h1>Events</h1>
          <div className="page-head__sub">Safety &amp; system activity</div>
        </div>
      </header>
      <p className="muted">
        A durable record of safety and system events — kept after the live notification clears, so
        you can reconstruct what happened. Best-effort, not a certified log: the oldest rows roll
        off past the retention cap. Frigate rows are close-range detections, not a hazard detector.
      </p>

      <div
        role="tablist"
        aria-label="Event type filter"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`chip ${filter === f.key ? 'chip--info' : 'chip--neutral'}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {frigate && !frigate.configured && (filter === 'all' || filter === 'frigate') && (
        <div className="chip chip--caution" style={{ marginTop: 8 }}>
          Frigate is not connected — no detection rows will appear here. Wire it in the plugin
          settings if you run one.
        </div>
      )}
      {frigate?.configured === true && frigate.connected === false && (
        <div className="chip chip--caution" style={{ marginTop: 8 }}>
          Frigate is configured but its MQTT link is down — detections are not flowing.
        </div>
      )}

      {err && <div className="chip chip--caution">Can’t load events ({err})</div>}
      {loaded && events.length === 0 && !err && (
        <div className="empty">
          <p>No events{filter === 'all' ? ' yet' : ' of this type'}.</p>
          <p className="muted">MOB, incidents, anchor drags and offline cameras land here.</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="events__list">
          {events.map((ev) => {
            const v = describeEvent(ev);
            return (
              <div className="event" key={ev.id}>
                <span className="event__icon" aria-hidden="true">
                  {v.icon}
                </span>
                <div className="event__body">
                  <div className="event__head">
                    <span className="event__label">{v.label}</span>
                    {ev.state && <span className={chipClass[v.severity]}>{ev.state}</span>}
                    {v.frigate && (
                      <span className="chip chip--caution">
                        close-range — not a hazard detector
                      </span>
                    )}
                    {v.href && (
                      <a className="chip chip--info" href={v.href}>
                        View →
                      </a>
                    )}
                  </div>
                  {ev.message && <div className="event__msg">{ev.message}</div>}
                </div>
                <time className="event__time" dateTime={new Date(ev.at).toISOString()}>
                  {new Date(ev.at).toLocaleString()}
                </time>
              </div>
            );
          })}
        </div>
      )}

      {events.length > 0 && !ended && (
        <button
          type="button"
          className="iconbtn iconbtn--wide"
          onClick={loadOlder}
          disabled={busy}
          style={{ marginTop: 12 }}
        >
          {busy ? 'Loading…' : 'Load older'}
        </button>
      )}
    </div>
  );
}
