import { useState } from 'react';
import { THEMES, THEME_LABELS, type Theme } from '../lib/theme';
import { DENSITIES, DENSITY_LABELS, type Density } from '../lib/density';
import {
  loadContinuousPtz,
  saveContinuousPtz,
  loadTapToAim,
  saveTapToAim,
} from '../lib/ptz-prefs';
import { useAuth } from '../lib/auth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ActivityMonitor } from '../components/ActivityMonitor';
import { SafetyAlerts } from './SafetyAlerts';
import { OperationalSettings } from './OperationalSettings';

interface Props {
  theme: Theme;
  onTheme: (t: Theme) => void;
  density: Density;
  onDensity: (d: Density) => void;
}

/**
 * Operator-owned display settings, plus an honest signpost to the Signal K admin for the operational
 * config that re-wires process subsystems on restart (cameras, recording, Frigate, anchor watch). Theme
 * is the one thing that shapes the console itself; it persists per device.
 */
export function Settings({ theme, onTheme, density, onDensity }: Props) {
  const [continuousPtz, setContinuousPtz] = useState(() => loadContinuousPtz());
  const [tapToAim, setTapToAim] = useState(() => loadTapToAim());
  const { state: authState, session, username, userLevel, signOut } = useAuth();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const toggleContinuous = (): void => {
    const next = !continuousPtz;
    setContinuousPtz(next);
    saveContinuousPtz(next);
  };
  const toggleTapToAim = (): void => {
    const next = !tapToAim;
    setTapToAim(next);
    saveTapToAim(next);
  };
  // Sign-out only makes sense on a secured server where this device holds a session.
  const showSession =
    session?.securityEnabled === true && (authState === 'signedIn' || authState === 'readonly');
  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="page-head__sub">Display · this device</div>
        </div>
      </header>

      <section className="panel">
        <h2 className="panel__title">Theme</h2>
        <p className="muted">
          Dark by default. Day is a light theme for a sunlit helm; Night-Red preserves dark
          adaptation at sea — red on near-black, no glow, dimmed video. Video always stays on a
          near-black mat.
        </p>
        <div className="seg" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`iconbtn iconbtn--wide${theme === t ? ' iconbtn--on' : ''}`}
              aria-pressed={theme === t}
              onClick={() => onTheme(t)}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Density</h2>
        <p className="muted">
          Helm is roomy with large touch targets for a moving helm; Desk is tighter for a
          chart-table desktop. Defaults to your device, but your choice wins.
        </p>
        <div className="seg" role="group" aria-label="Density">
          {DENSITIES.map((d) => (
            <button
              key={d}
              type="button"
              className={`iconbtn iconbtn--wide${density === d ? ' iconbtn--on' : ''}`}
              aria-pressed={density === d}
              onClick={() => onDensity(d)}
            >
              {DENSITY_LABELS[d]}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Camera controls</h2>
        <p className="muted">
          PTZ defaults to discrete nudge taps — a one-shot move can’t run away from you, and the
          hard STOP is always present. Press-and-hold continuous pan (pad drag and full-frame drag)
          is an opt-in for this device; it stays off on a still-refresh feed either way.
        </p>
        <button
          type="button"
          className={`iconbtn iconbtn--wide${continuousPtz ? ' iconbtn--on' : ''}`}
          aria-pressed={continuousPtz}
          onClick={toggleContinuous}
        >
          {continuousPtz ? 'Continuous PTZ: on' : 'Continuous PTZ: off'}
        </button>
        <p className="muted">
          Tap-to-aim: tap a point on a PTZ camera’s live view to aim there. It’s a bounded, recoverable
          move (the tapped point eases toward centre), on by default; it stays off on a still-refresh
          feed.
        </p>
        <button
          type="button"
          className={`iconbtn iconbtn--wide${tapToAim ? ' iconbtn--on' : ''}`}
          aria-pressed={tapToAim}
          onClick={toggleTapToAim}
        >
          {tapToAim ? 'Tap to aim: on' : 'Tap to aim: off'}
        </button>
      </section>

      {showSession && (
        <section className="panel">
          <h2 className="panel__title">Session</h2>
          <p className="muted">
            Signed in with your Signal K credentials
            {username ? ` as ${username}` : ''}
            {userLevel ? ` (${userLevel})` : ''}. Signing out returns this device to the sign-in
            screen; the live feed keeps running for everyone else on this server.
          </p>
          <button
            type="button"
            className="iconbtn iconbtn--wide"
            onClick={() => setConfirmSignOut(true)}
          >
            Sign out
          </button>
        </section>
      )}

      <ActivityMonitor />

      <SafetyAlerts />

      <OperationalSettings />

      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out of SK Video?"
          body="Returns to the sign-in screen. The live feed keeps running for everyone else on this server."
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          onConfirm={() => {
            setConfirmSignOut(false);
            void signOut();
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </div>
  );
}
