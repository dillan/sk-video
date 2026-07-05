/* eslint-disable react-refresh/only-export-components --
   This is a provider module: the AuthProvider and its useAuth/useWriteGate hooks belong together;
   splitting them out to satisfy fast-refresh would only scatter one cohesive concern. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fetchSession, login, logout, setAuthObserver, type ISessionInfo } from '../api';
import { deriveAuthState, normalizeSession, type AuthState, type Session } from './auth-state';

/**
 * The single source of auth truth for the whole console. SK Video has no user system — it rides
 * Signal K's session cookie — so this provider does three things:
 *
 * 1. probes GET /session (on mount, on reconnect, on tab foreground) and normalizes the answer;
 * 2. listens on the api layer's auth-failure observer and, on any 401/403, RE-PROBES /session and
 *    branches on the fresh truth — never on the status code — so a read-only user's write-refusal
 *    lands on read-only (ask an admin), a genuine lapse lands on re-auth, and a non-auth failure is
 *    left as an honest inline error. That re-probe is the fix for the read-only re-auth loop;
 * 3. derives the ten UI states and hands out `useAuth()` / `useWriteGate()` so ~20 write controls and
 *    the shell read one consistent picture without prop-drilling.
 *
 * Guards: the re-probe is single-flight (a burst of parallel challenges coalesces to one probe), and
 * a short grace window after a successful sign-in drops a stale 401 from a request that was already
 * in flight, so a just-authenticated user is never yanked back to sign-in.
 */

const PROBE_COOLDOWN_MS = 800; // after a challenge-driven probe, ignore further challenges briefly
const SIGNIN_GRACE_MS = 1500; // after a successful sign-in, drop stale challenges for this long

export interface AuthContextValue {
  state: AuthState;
  session: Session | null;
  /** Convenience: writable unless we KNOW the session is read-only (unknown/checking is optimistic). */
  canWrite: boolean;
  username?: string;
  userLevel?: string;
  /** The last sign-in error message, for the sign-in surface (null when none). */
  signInError: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reprobe: () => Promise<void>;
  /** Adopt a session fetched elsewhere (e.g. the existing SignIn component), with the sign-in grace. */
  adoptSession: (info: ISessionInfo) => void;
  /** The shell reports WS connectivity so a true outage (with no cached session) reads as unreachable. */
  setLinkUnreachable: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [signing, setSigning] = useState<'none' | 'in' | 'out'>('none');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [everLoggedIn, setEverLoggedIn] = useState(false);
  const [netError, setNetError] = useState(false);
  const [linkUnreachable, setLinkUnreachable] = useState(false);

  const mounted = useRef(true);
  const reprobeInFlight = useRef<Promise<void> | null>(null);
  const cooldownUntil = useRef(0);
  const suppressUntil = useRef(0);

  const applyProbe = useCallback((info: ISessionInfo) => {
    if (!mounted.current) return;
    const norm = normalizeSession(info);
    setSession(norm);
    setNetError(false);
    // Remember we once held a real session on a secured server — that is what separates a lapse
    // (state 7, re-auth) from a cold, never-signed-in load (state 4, sign-in required).
    if (norm.securityEnabled && (norm.canWrite || norm.loggedIn)) {
      setEverLoggedIn(true);
    }
  }, []);

  const reprobe = useCallback(
    (armCooldown = false): Promise<void> => {
      if (reprobeInFlight.current) return reprobeInFlight.current; // coalesce concurrent probes
      const p = (async () => {
        try {
          applyProbe(await fetchSession());
        } catch {
          // A network/5xx failure is an outage, not an answer. Keep any cached session on screen;
          // it only reads as "unreachable" when we have nothing to show (see deriveAuthState).
          if (mounted.current) setNetError(true);
        } finally {
          if (armCooldown) cooldownUntil.current = Date.now() + PROBE_COOLDOWN_MS;
          reprobeInFlight.current = null;
        }
      })();
      reprobeInFlight.current = p;
      return p;
    },
    [applyProbe],
  );

  // Listen for a refused request. On any 401/403 the api layer reports here; we re-probe and let the
  // fresh /session decide the state. Suppressed briefly right after a sign-in, and rate-limited by a
  // short cooldown so a stuck client can't storm /session.
  useEffect(() => {
    setAuthObserver(() => {
      const now = Date.now();
      if (now < suppressUntil.current) return; // just signed in — ignore an in-flight stale 401
      if (now < cooldownUntil.current) return; // just probed — let it settle
      void reprobe(true);
    });
    return () => setAuthObserver(null);
  }, [reprobe]);

  // Initial probe.
  useEffect(() => {
    mounted.current = true;
    void reprobe();
    return () => {
      mounted.current = false;
    };
  }, [reprobe]);

  const signIn = useCallback(
    async (username: string, password: string): Promise<void> => {
      setSigning('in');
      setSignInError(null);
      try {
        await login(username, password);
        // Success: open the grace window and force a fresh probe to win over any in-flight one.
        suppressUntil.current = Date.now() + SIGNIN_GRACE_MS;
        reprobeInFlight.current = null;
        applyProbe(await fetchSession());
      } catch (err) {
        if (mounted.current) {
          setSignInError(err instanceof Error ? err.message : 'Sign-in failed.');
        }
      } finally {
        if (mounted.current) setSigning('none');
      }
    },
    [applyProbe],
  );

  const signOut = useCallback(async (): Promise<void> => {
    setSigning('out');
    try {
      await logout();
    } catch {
      // best-effort; we re-probe regardless to reflect the true post-logout state
    }
    if (mounted.current) setEverLoggedIn(false);
    reprobeInFlight.current = null;
    try {
      applyProbe(await fetchSession());
    } catch {
      if (mounted.current) setNetError(true);
    }
    if (mounted.current) setSigning('none');
  }, [applyProbe]);

  const adoptSession = useCallback(
    (info: ISessionInfo): void => {
      suppressUntil.current = Date.now() + SIGNIN_GRACE_MS;
      setSignInError(null);
      setSigning('none');
      applyProbe(info);
    },
    [applyProbe],
  );

  const state = deriveAuthState(session, {
    unreachable: netError || linkUnreachable,
    signing,
    everLoggedIn,
    signInError: signInError !== null,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      session,
      canWrite: session ? session.canWrite : true,
      username: session?.username,
      userLevel: session?.userLevel,
      signInError,
      signIn,
      signOut,
      reprobe,
      adoptSession,
      setLinkUnreachable,
    }),
    [state, session, signInError, signIn, signOut, reprobe, adoptSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

/**
 * A one-line disable-with-reason helper for every write control. Returns the shape the existing
 * `disabled` + `title` idiom already consumes. Only a KNOWN read-only session disables a control —
 * while the session is still unknown (checking) controls stay live, so nothing flickers on load.
 */
export function useWriteGate(reason: string): { disabled: boolean; title?: string } {
  // Tolerant of a missing provider: a control rendered outside the AuthProvider (e.g. in an isolated
  // unit test) is simply not gated. Only a KNOWN read-only session disables it.
  const ctx = useContext(AuthContext);
  const blocked = ctx?.session != null && !ctx.session.canWrite;
  return blocked ? { disabled: true, title: reason } : { disabled: false };
}
