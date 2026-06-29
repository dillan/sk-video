import { useEffect, useState } from 'react';
import {
  fetchSession,
  fetchMobStatus,
  describeAuth,
  type ISessionInfo,
  type IMobStatus,
} from './api';
import { useHashRoute } from './lib/router';
import { NavRail, TabBar } from './components/Nav';
import { LiveWall } from './screens/LiveWall';
import { Stub } from './screens/Stub';

/**
 * The Deference app shell: a side rail (tablet/desktop) or bottom tab bar (phone) around the active
 * screen. Live is the hero. Session + MOB are shell-level concerns (auth chip, safety state); each
 * screen owns its own data. Read-only / sign-in-required shows a non-modal banner rather than blocking.
 */
export function App() {
  const [route, navigate] = useHashRoute();
  const [session, setSession] = useState<ISessionInfo | null>(null);
  const [mob, setMob] = useState<IMobStatus | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    // Best-effort: a failed probe just leaves the chip "checking…" and the strip without MOB state.
    fetchSession(ctrl.signal)
      .then(setSession)
      .catch(() => undefined);
    fetchMobStatus(ctrl.signal)
      .then(setMob)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const authChip = (
    <span className="chip chip--neutral" title="Authentication">
      {describeAuth(session)}
    </span>
  );
  const signInRequired = session?.securityEnabled === true && session.authenticated === false;

  return (
    <div className="shell">
      <NavRail current={route} onNavigate={navigate} authChip={authChip} />
      <div className="content">
        {signInRequired && (
          <div className="reauth" role="status">
            <span>Sign-in required — controls stay read-only until you sign in to Signal K.</span>
          </div>
        )}
        {route === 'live' && <LiveWall mob={mob} />}
        {route === 'review' && (
          <Stub
            title="Review"
            note="Recordings, the event timeline, incidents, and snapshots land in a later slice."
          />
        )}
        {route === 'cameras' && (
          <Stub
            title="Cameras"
            note="Camera management, zero-typing onboarding, and PTZ calibration land in a later slice."
          />
        )}
        {route === 'safety' && (
          <Stub
            title="Safety"
            note="The man-overboard and AIS-slew console lands in a later slice."
          />
        )}
      </div>
      <TabBar current={route} onNavigate={navigate} />
    </div>
  );
}
