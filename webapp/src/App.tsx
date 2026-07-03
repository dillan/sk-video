import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSession,
  fetchMobStatus,
  fetchVesselSelf,
  fetchStatus,
  fetchRecordingTimeline,
  describeAuth,
  SK_ROOT,
  type ISessionInfo,
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
import { NavRail, TabBar } from './components/Nav';
import { SignIn } from './components/SignIn';
import { SafetyBanner } from './components/SafetyBanner';
import { TelemetryStrip } from './components/TelemetryStrip';
import { LiveWall } from './screens/LiveWall';
import { CameraFocus } from './screens/CameraFocus';
import { Safety } from './screens/Safety';
import { Cameras } from './screens/Cameras';
import { Settings } from './screens/Settings';
import { Review } from './screens/Review';

/** Refresh cadence for the recording tally (a light read; the strip only shows a count). */
const RECORDING_REFRESH_MS = 60_000;

/**
 * The Deference app shell: a side rail (tablet/desktop) or bottom tab bar (phone) around the active
 * screen. Live is the hero. Session, vessel state, MOB, and safety alerts are shell-level concerns:
 * one Signal K delta stream feeds a PERSISTENT status strip (GPS fix, heading/SOG, MOB with its
 * armed-at stamp, reconnecting state) and the reserved safety escalation banner on every screen.
 * On every (re)connect the shell reseeds GET /mob before trusting deltas, so a reconnect can never
 * silently under-report an active MOB.
 */
export function App() {
  const [route, navigate] = useHashRoute();
  const [session, setSession] = useState<ISessionInfo | null>(null);
  const [mob, setMob] = useState<IMobStatus | null>(null);
  const [vessel, setVessel] = useState<IVesselState | null>(null);
  const [alerts, setAlerts] = useState<Record<string, IAlert>>({});
  const [link, setLink] = useState<TStreamState>('connecting');
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [tier, setTier] = useState<string | undefined>();
  const [recording, setRecording] = useState(0);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [density, setDensity] = useState<Density>(() => loadDensity());
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

  useEffect(() => {
    const ctrl = new AbortController();
    // Best-effort: a failed probe just leaves the chip "checking…" and the strip without MOB state.
    fetchSession(ctrl.signal)
      .then(setSession)
      .catch(() => undefined);
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

  // The one delta stream for the whole shell (vessel + notifications). jsdom has no WebSocket;
  // the strip then runs on the REST seeds alone, which the tests exercise.
  useEffect(() => {
    if (typeof WebSocket === 'undefined') return;
    const stream = new SkStream({
      url: streamUrl(window.location, SK_ROOT),
      onState: setLink,
      onConnect: () => {
        // Authoritative reseed BEFORE trusting deltas (the plan's reconnect rule).
        reseedMob();
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
  }, [reseedMob]);

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
        <div className="shellstrip">
          <TelemetryStrip
            vessel={vessel}
            mob={mob}
            recordingCount={recording}
            tierLabel={tier}
            link={link}
            lastSyncAt={lastSyncAt}
          />
        </div>
        <SafetyBanner alerts={alerts} />
        {signInRequired && <SignIn onSignedIn={setSession} />}
        {route.cluster === 'live' &&
          (route.id ? (
            <CameraFocus cameraId={route.id} onBack={() => navigate('live')} />
          ) : (
            <LiveWall onOpenCamera={(id) => navigate('live', id)} />
          ))}
        {route.cluster === 'review' && (
          <Review tab={route.id} onTab={(t) => navigate('review', t)} />
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
