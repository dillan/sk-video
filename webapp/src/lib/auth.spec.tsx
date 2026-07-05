import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock the api layer so we can drive the auth observer by hand and control /session answers.
const api = vi.hoisted(() => {
  const box: { observer: ((s: { status: number; method: string; url: string }) => void) | null } = {
    observer: null,
  };
  return {
    box,
    fetchSession: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    setAuthObserver: vi.fn((fn: typeof box.observer) => {
      box.observer = fn;
    }),
  };
});
vi.mock('../api', () => ({
  fetchSession: api.fetchSession,
  login: api.login,
  logout: api.logout,
  setAuthObserver: api.setAuthObserver,
}));

import { AuthProvider, useAuth, useWriteGate } from './auth';

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

/** A full /session payload; override fields per test. Writable + signed-in by default. */
const S = (o: Record<string, unknown> = {}) => ({
  securityEnabled: true,
  authenticated: true,
  readOnly: false,
  loggedIn: true,
  canWrite: true,
  anonymous: false,
  pluginVersion: '1',
  ...o,
});
const lapsed = () => S({ authenticated: false, loggedIn: false, canWrite: false });
const readonly = () => S({ canWrite: false, readOnly: true, loggedIn: true });

function fireChallenge(status = 401): void {
  api.box.observer?.({ status, method: 'POST', url: '/plugins/sk-video/cameras/x/ptz' });
}

beforeEach(() => {
  api.fetchSession.mockReset();
  api.login.mockReset();
  api.logout.mockReset();
  api.box.observer = null;
});

describe('AuthProvider', () => {
  it('probes on mount and lands on the reported state', async () => {
    api.fetchSession.mockResolvedValue(S());
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('signedIn'));
  });

  it('a read-only write-refusal re-probes ONCE and lands on read-only — never re-auth', async () => {
    api.fetchSession.mockResolvedValue(readonly());
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('readonly'));

    api.fetchSession.mockClear();
    await act(async () => {
      // a burst of parallel write-401/403s, as a PTZ hold or fan-out would produce
      fireChallenge(403);
      fireChallenge(403);
      fireChallenge(401);
    });
    await waitFor(() => expect(result.current.state).toBe('readonly'));
    expect(api.fetchSession).toHaveBeenCalledTimes(1); // single-flight coalesced the burst
  });

  it('a session-401 on a cold load shows sign-in required (not unreachable)', async () => {
    api.fetchSession.mockResolvedValue(lapsed());
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('signinRequired'));
  });

  it('a lapse after being signed in shows re-auth (keeps the context)', async () => {
    api.fetchSession.mockResolvedValueOnce(S());
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('signedIn'));

    api.fetchSession.mockResolvedValue(lapsed());
    await act(async () => fireChallenge(401));
    await waitFor(() => expect(result.current.state).toBe('reauth'));
  });

  it('a 403 whose re-probe still shows writable stays signed-in (honest error, no re-auth)', async () => {
    api.fetchSession.mockResolvedValue(S());
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('signedIn'));

    await act(async () => fireChallenge(403));
    await waitFor(() => expect(result.current.state).toBe('signedIn'));
  });

  it('signs in and lands signed-in, dropping a stale 401 that arrives just after (race guard)', async () => {
    api.fetchSession.mockResolvedValueOnce(lapsed());
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('signinRequired'));

    api.login.mockResolvedValue(undefined);
    api.fetchSession.mockResolvedValue(S());
    await act(async () => {
      await result.current.signIn('skipper', 'pw');
    });
    await waitFor(() => expect(result.current.state).toBe('signedIn'));

    const calls = api.fetchSession.mock.calls.length;
    await act(async () => fireChallenge(401)); // a request that was in flight during sign-in
    expect(result.current.state).toBe('signedIn'); // suppressed
    expect(api.fetchSession).toHaveBeenCalledTimes(calls); // no extra probe
  });

  it('is unreachable when the cold probe network-fails (never a login form)', async () => {
    api.fetchSession.mockRejectedValue(new Error('session 500'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('unreachable'));
  });

  it('signs out back to sign-in and forgets it was ever signed in', async () => {
    api.fetchSession.mockResolvedValueOnce(S());
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('signedIn'));

    api.logout.mockResolvedValue(undefined);
    api.fetchSession.mockResolvedValue(lapsed());
    await act(async () => {
      await result.current.signOut();
    });
    // everLoggedIn is cleared, so a lapsed probe is "sign in required", not "re-auth"
    await waitFor(() => expect(result.current.state).toBe('signinRequired'));
  });
});

describe('useWriteGate', () => {
  it('disables with a reason only for a known read-only session', async () => {
    api.fetchSession.mockResolvedValue(readonly());
    const { result } = renderHook(() => useWriteGate('Aim & zoom need write access'), { wrapper });
    await waitFor(() =>
      expect(result.current).toEqual({ disabled: true, title: 'Aim & zoom need write access' }),
    );
  });

  it('does not disable a writable session', async () => {
    api.fetchSession.mockResolvedValue(S());
    const { result } = renderHook(() => useWriteGate('need write'), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ disabled: false }));
  });
});
