import { useState } from 'react';
import { ackNotification } from '../api';
import type { IAlert } from '../lib/sk-stream';

/**
 * The reserved safety escalation surface (never a toast): a full-bleed pulsing banner for each
 * live alarm/emergency notification, persistent until the shared state clears or is acknowledged.
 * Acknowledge writes back to Signal K notification state, so it silences EVERY client; a silenced
 * alarm demotes to a quiet chip (still visible — the condition has not cleared). Lower states
 * (warn/alert) render as chips, never full-bleed.
 */
export function SafetyBanner({ alerts }: { alerts: Record<string, IAlert> }) {
  const [acking, setAcking] = useState<string | null>(null);
  const all = Object.values(alerts);
  if (all.length === 0) return null;
  const loud = all.filter((a) => !a.silenced && (a.state === 'alarm' || a.state === 'emergency'));
  const quiet = all.filter((a) => !loud.includes(a));

  const ack = (key: string): void => {
    setAcking(key);
    // Shared-state ack; the banner drops when the silenced delta comes back around.
    ackNotification(key)
      .catch(() => undefined)
      .finally(() => setAcking(null));
  };

  return (
    <div className="alerts" role="alert" aria-live="assertive">
      {loud.map((a) => (
        <div key={a.key} className="alerts__banner">
          <span className="alerts__pulse" aria-hidden="true" />
          <span className="alerts__msg">{a.message || a.key}</span>
          <button
            type="button"
            className="btn alerts__ack"
            disabled={acking === a.key}
            onClick={() => ack(a.key)}
            title="Silences this alarm on every client (the condition stays visible until it clears)"
          >
            Acknowledge
          </button>
        </div>
      ))}
      {quiet.length > 0 && (
        <div className="alerts__quiet">
          {quiet.map((a) => (
            <span key={a.key} className="chip chip--caution" title={a.key}>
              {a.silenced ? 'acknowledged · ' : ''}
              {a.message || a.key}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
