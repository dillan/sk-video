import { useCallback, useEffect, useState } from 'react';
import { fetchEvents, type ILoggedEvent } from '../api';

const PAGE = 100;

type Severity = 'alarm' | 'caution' | 'neutral';

interface IEventView {
  icon: string;
  label: string;
  /** True for Frigate rows, which get an honest close-range caveat. */
  frigate: boolean;
  severity: Severity;
}

/** Turn a raw notification key + state into a human row: label, icon, and severity treatment. */
function describeEvent(ev: ILoggedEvent): IEventView {
  const state = (ev.state ?? '').toLowerCase();
  const severity: Severity =
    state === 'emergency' || state === 'alarm'
      ? 'alarm'
      : state === 'alert' || state === 'warn' || state === 'warning'
        ? 'caution'
        : 'neutral';

  const offline = /^camera\.(.+)\.offline$/.exec(ev.type);
  if (ev.type === 'mob') return { icon: '🆘', label: 'Man overboard', frigate: false, severity };
  if (offline)
    return { icon: '📷', label: `Camera offline · ${offline[1]}`, frigate: false, severity };
  if (/^incident/.test(ev.type)) return { icon: '🎬', label: 'Incident', frigate: false, severity };
  if (/^anchor/.test(ev.type))
    return { icon: '⚓', label: 'Anchor watch', frigate: false, severity };
  if (/^frigate/.test(ev.type))
    return { icon: '👁', label: 'Frigate detection', frigate: true, severity };
  return { icon: '•', label: ev.type, frigate: false, severity };
}

const chipClass: Record<Severity, string> = {
  alarm: 'chip chip--alarm',
  caution: 'chip chip--caution',
  neutral: 'chip chip--neutral',
};

/**
 * The Review cluster's Events tab: the durable activity feed (MOB, incidents, anchor drag, cameras
 * going dark). It's the retrospective record the live notification stream can't be — notifications
 * vanish on clear, this log doesn't. Honest about Frigate: those rows are close-range detections from
 * a user-run Frigate, not a hazard or MOB-at-distance detector.
 */
export function Events() {
  const [events, setEvents] = useState<ILoggedEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchEvents({ limit: PAGE }, ctrl.signal)
      .then((rows) => {
        setEvents(rows);
        setEnded(rows.length === 0);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : 'unreachable');
      });
    return () => ctrl.abort();
  }, []);

  const loadOlder = useCallback(() => {
    if (busy || events.length === 0) return;
    setBusy(true);
    const before = events[events.length - 1].at;
    fetchEvents({ limit: PAGE, before })
      .then((rows) => {
        setEvents((prev) => [...prev, ...rows]);
        if (rows.length === 0) setEnded(true);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'unreachable'))
      .finally(() => setBusy(false));
  }, [busy, events]);

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
        you can reconstruct what happened. Frigate rows are close-range detections, not a hazard
        detector.
      </p>

      {err && <div className="chip chip--caution">Can’t load events ({err})</div>}
      {loaded && events.length === 0 && !err && (
        <div className="empty">
          <p>No events yet.</p>
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
