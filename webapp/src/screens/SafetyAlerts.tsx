import { useEffect, useState } from 'react';
import { currentPushState, enablePush, disablePush, type TPushState } from '../lib/push';

/**
 * The safety-alerts opt-in panel: a per-device toggle for Web Push. Honest about the bounds — alerts
 * are best-effort, need the boat to have connectivity to send, and (on iOS) require the app be
 * installed to the Home Screen first. State is read from the actual push subscription so it survives
 * reloads and reflects a permission the user changed in browser settings.
 */
export function SafetyAlerts() {
  const [state, setState] = useState<TPushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    currentPushState()
      .then((s) => live && setState(s))
      .catch(() => live && setState('unsupported'));
    return () => {
      live = false;
    };
  }, []);

  const toggle = async () => {
    setBusy(true);
    setErr(null);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'could not change alerts');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Safety alerts</h2>
      <p className="muted">
        Get a push notification when a safety event fires (man overboard, anchor drag, a safety camera
        going dark, an incident) — even when the app is closed. Best-effort: the boat needs internet
        to send, and on iPhone you must add the app to your Home Screen first. Delivery goes through
        your browser’s push service; the alert content is encrypted end-to-end.
      </p>

      {state === 'loading' && <div className="chip chip--neutral">Checking…</div>}
      {state === 'unsupported' && (
        <div className="chip chip--caution">This browser doesn’t support push alerts.</div>
      )}
      {state === 'denied' && (
        <div className="chip chip--caution">
          Notifications are blocked — allow them for this site in your browser settings, then return.
        </div>
      )}
      {(state === 'on' || state === 'off') && (
        <div className="dvr__panel">
          <span className="chip chip--neutral">
            {state === 'on' ? 'Alerts are on for this device.' : 'Alerts are off for this device.'}
          </span>
          <button
            type="button"
            className={`iconbtn iconbtn--wide${state === 'on' ? ' iconbtn--on' : ''}`}
            onClick={() => void toggle()}
            disabled={busy}
          >
            {busy ? 'Working…' : state === 'on' ? 'Turn off alerts' : 'Enable alerts'}
          </button>
        </div>
      )}
      {err && <div className="chip chip--caution">{err}</div>}
    </section>
  );
}
