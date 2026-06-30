import { useEffect, useState } from 'react';
import {
  fetchSession,
  fetchMobStatus,
  describeAuth,
  type ISessionInfo,
  type IMobStatus,
} from './api';
import { useHashRoute } from './lib/router';
import { applyTheme, loadTheme, type Theme } from './lib/theme';
import { applyDensity, loadDensity, type Density } from './lib/density';
import { NavRail, TabBar } from './components/Nav';
import { LiveWall } from './screens/LiveWall';
import { CameraFocus } from './screens/CameraFocus';
import { Safety } from './screens/Safety';
import { Cameras } from './screens/Cameras';
import { Settings } from './screens/Settings';
import { ImportedVideos } from './screens/ImportedVideos';

/**
 * The Deference app shell: a side rail (tablet/desktop) or bottom tab bar (phone) around the active
 * screen. Live is the hero. Session + MOB are shell-level concerns (auth chip, safety state); each
 * screen owns its own data. Read-only / sign-in-required shows a non-modal banner rather than blocking.
 */
export function App() {
  const [route, navigate] = useHashRoute();
  const [session, setSession] = useState<ISessionInfo | null>(null);
  const [mob, setMob] = useState<IMobStatus | null>(null);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [density, setDensity] = useState<Density>(() => loadDensity());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    applyDensity(density);
  }, [density]);

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
      <NavRail current={route.cluster} onNavigate={(c) => navigate(c)} authChip={authChip} />
      <div className="content">
        {signInRequired && (
          <div className="reauth" role="status">
            <span>Sign-in required — controls stay read-only until you sign in to Signal K.</span>
          </div>
        )}
        {route.cluster === 'live' &&
          (route.id ? (
            <CameraFocus cameraId={route.id} onBack={() => navigate('live')} />
          ) : (
            <LiveWall mob={mob} onOpenCamera={(id) => navigate('live', id)} />
          ))}
        {route.cluster === 'review' && <ImportedVideos />}
        {route.cluster === 'cameras' && <Cameras />}
        {route.cluster === 'safety' && <Safety onMobChange={setMob} />}
        {route.cluster === 'settings' && (
          <Settings theme={theme} onTheme={setTheme} density={density} onDensity={setDensity} />
        )}
      </div>
      <TabBar current={route.cluster} onNavigate={(c) => navigate(c)} />
    </div>
  );
}
