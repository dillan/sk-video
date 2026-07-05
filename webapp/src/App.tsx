import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchMobStatus,
  fetchVesselSelf,
  fetchStatus,
  fetchRecordingTimeline,
  SK_ROOT,
  type IMobStatus,
} from './api';
import { useHashRoute } from './lib/router';
import { applyTheme, loadTheme, type Theme } from './lib/theme';
import { applyDensity, loadDensity, type Density } from './lib/density';
import { parseVesselState, type IVesselState } from './lib/format';
import {
  SkStream,
  streamUrl,
  applyVesselDelta,
  notificationKey,
  reduceAlerts,
  type IAlert,
  type TStreamState,
} from './lib/sk-stream';
import { AuthProvider, useAuth } from './lib/auth';
import type { AuthState } from './lib/auth-state';
import { NavRail, TabBar } from './components/Nav';
import { SignIn } from './components/SignIn';
import { ReAuth } from './components/ReAuth';
import { ReadOnlyRibbon } from './components/ReadOnlyRibbon';
import { SafetyBanner } from './components/SafetyBanner';
import { TelemetryStrip } from './components/TelemetryStrip';
import { LiveWall } from './screens/LiveWall';
import { CameraFocus } from './screens/CameraFocus';
import { Safety } from './screens/Safety';
import { Cameras } from './screens/Cameras';
import { Settings } from './screens/Settings';
import { Library } from './screens/Library';

/** Refresh cadence for the recording tally (a light read; the strip only shows a count). */
const RECORDING_REFRESH_MS = 60_000;

/** The auth-chip text for a posture. Phase 2 layers the per-state colour treatment on top. */
function authChipText(state: AuthState, username?: string): string {
  switch (state) {
    case 'open':
      return 'open server';
    case 'signedIn':
      return username ? `${username} · full control` : 'secured · signed in';
    case 'readonly':
      return 'secured · read-only';
    case 'signinRequired':
    case 'signingIn':
    case 'signinFailed':
      return 'secured · sign in required';
    case 'reauth':
      return 'session expired';
    case 'unreachable':
      return 'offline';
    default:
      return 'checking…';
  }
}

/**
 * The Deference app shell: a side rail (tablet/desktop) or bottom tab bar (phone) around the active
 * screen. Live is the hero. Session/auth is owned by the AuthProvider (one source of truth, one
 * re-probe-and-branch on any 401/403); vessel state, MOB, and safety alerts are shell concerns fed by
 * one Signal K delta stream. On every (re)connect the shell reseeds GET /mob and re-probes /session
 * before trusting deltas, so a reconnect can never silently under-report an active MOB or a lapse.
 */
function AppShell() {
  const [route, navigate] = useHashRoute();
  const { state: authState, session, username, everLoggedIn, reprobe } = useAuth();
  const [mob, setMob] = useState<IMobStatus | null>(null);
  const [vessel, setVessel] = useState<IVesselState | null>(null);
  const [alerts, setAlerts] = useState<Record<string, IAlert>>({});
  const [link, setLink] = useState<TStreamState>('connecting');
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [tier, setTier] = useState<string | undefined>();
  const [recording, setRecording] = useState(0);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [density, setDensity] = useState<Density>(() => loadDensity());
  const [staleShell, setStaleShell] = useState(false);
  const firstVersion = useRef<string | null>(null);
  const mobRef = useRef<IMobStatus | null>(null);
  mobRef.current = mob;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const reseedMob = useCallback((): void => {
    fetchMobStatus()
      .then((s) => {
        setMob(s);
        setLastSyncAt(Date.now());
      })
      .catch(() => undefined);
  }, []);

  // Seed the shell's non-auth state on mount (the AuthProvider owns the /session probe).
  useEffect(() => {
    const ctrl = new AbortController();
    reseedMob();
    fetchVesselSelf(ctrl.signal)
      .then((raw) => setVessel(parseVesselState(raw)))
      .catch(() => setVessel({ hasFix: false }));
    fetchStatus(ctrl.signal)
      .then((s) => setTier(s.hardware?.label ?? s.hardware?.tier))
      .catch(() => undefined);
    const refreshRecording = (): void => {
      fetchRecordingTimeline()
        .then((t) => setRecording(t.cameras.filter((c) => c.recording).length))
        .catch(() => undefined);
    };
    refreshRecording();
    const recTimer = setInterval(refreshRecording, RECORDING_REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(recTimer);
    };
  }, [reseedMob]);

  // A long-lived tab (a helm display) can outlive a plugin update: when the served pluginVersion
  // changes, offer a non-modal reload. The stale shell keeps working meanwhile.
  useEffect(() => {
    const v = session?.pluginVersion;
    if (!v || v === 'unknown') return;
    if (firstVersion.current === null) {
      firstVersion.current = v;
    } else if (v !== firstVersion.current) {
      setStaleShell(true);
    }
  }, [session?.pluginVersion]);

  // On tab foreground, re-probe /session (picks up a plugin update and any silent session change).
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void reprobe();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reprobe]);

  // The one delta stream for the whole shell (vessel + notifications). Unit tests skip it (node's
  // global WebSocket would attempt real connections under jsdom); the strip then runs on REST seeds.
  useEffect(() => {
    if (typeof WebSocket === 'undefined' || import.meta.env.MODE === 'test') return;
    const stream = new SkStream({
      url: streamUrl(window.location, SK_ROOT),
      onState: setLink,
      onConnect: () => {
        // Authoritative reseed AND a session re-probe BEFORE trusting deltas (the reconnect rule).
        reseedMob();
        void reprobe();
        setLastSyncAt(Date.now());
      },
      onDelta: (values) => {
        setLastSyncAt(Date.now());
        for (const v of values) {
          const key = notificationKey(v.path);
          if (key !== null) {
            setAlerts((prev) => reduceAlerts(prev, key, v.value));
            if (key === 'mob') {
              reseedMob(); // the strip's armed state follows the authoritative read
            }
          } else {
            setVessel((prev) => applyVesselDelta(prev ?? { hasFix: false }, v));
          }
        }
      },
    });
    stream.start();
    return () => stream.stop();
  }, [reseedMob, reprobe]);

  const authChip = (
    <span className="chip chip--neutral" title="Authentication">
      {authChipText(authState, username)}
    </span>
  );
  // A lapsed session gets the dedicated non-modal re-auth banner (state 7); a cold, never-signed-in
  // load gets the calm sign-in. While a submit is in flight or after it failed, everLoggedIn keeps us
  // on the right surface (re-auth for a returning operator, sign-in for a first-timer).
  const midAuth = authState === 'signingIn' || authState === 'signinFailed';
  const showReauth = authState === 'reauth' || (midAuth && everLoggedIn);
  const showSignIn = authState === 'signinRequired' || (midAuth && !everLoggedIn);

  return (
    <div className="shell">
      <NavRail current={route.cluster} onNavigate={(c) => navigate(c)} authChip={authChip} />
      <div className="content">
        <div className="shellstrip">
          <TelemetryStrip
            vessel={vessel}
            mob={mob}
            recordingCount={recording}
            tierLabel={tier}
            link={link}
            lastSyncAt={lastSyncAt}
            stale={showReauth}
          />
        </div>
        <SafetyBanner alerts={alerts} />
        {authState === 'readonly' && <ReadOnlyRibbon />}
        {staleShell && (
          <div className="chip chip--info" role="status" style={{ margin: '8px 0' }}>
            SK Video was updated — reload for the new version.
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8 }}
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        )}
        {showReauth && <ReAuth />}
        {showSignIn && <SignIn />}
        {route.cluster === 'live' &&
          (route.id ? (
            <CameraFocus cameraId={route.id} onBack={() => navigate('live')} />
          ) : (
            <LiveWall onOpenCamera={(id) => navigate('live', id)} />
          ))}
        {route.cluster === 'library' && (
          <Library tab={route.id} onTab={(t) => navigate('library', t)} />
        )}
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

export function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
