import { describe, it, expect } from 'vitest';
import { deriveAuthState, normalizeSession, type Session, type DeriveInput } from './auth-state';

const writable: Session = {
  securityEnabled: true,
  loggedIn: true,
  canWrite: true,
  anonymous: false,
  pluginVersion: '1',
};
const input = (o: Partial<DeriveInput> = {}): DeriveInput => ({
  unreachable: false,
  signing: 'none',
  everLoggedIn: false,
  signInError: false,
  ...o,
});

describe('deriveAuthState', () => {
  it('is "checking" before the first probe resolves (reachable)', () => {
    expect(deriveAuthState(null, input())).toBe('checking');
  });

  it('is "unreachable" only when the probe network-failed with no session', () => {
    expect(deriveAuthState(null, input({ unreachable: true }))).toBe('unreachable');
  });

  it('lets a sign-out in flight dominate everything', () => {
    expect(deriveAuthState(writable, input({ signing: 'out' }))).toBe('signingOut');
    expect(deriveAuthState(null, input({ signing: 'out' }))).toBe('signingOut');
  });

  it('is "open" when security is off', () => {
    expect(deriveAuthState({ ...writable, securityEnabled: false }, input())).toBe('open');
  });

  it('is "signedIn" when secured and writable', () => {
    expect(deriveAuthState(writable, input())).toBe('signedIn');
  });

  it('is "signingIn" while a submit is in flight', () => {
    const lapsed = { ...writable, canWrite: false, loggedIn: false };
    expect(deriveAuthState(lapsed, input({ signing: 'in' }))).toBe('signingIn');
  });

  it('is "signinFailed" after a rejected submit', () => {
    const lapsed = { ...writable, canWrite: false, loggedIn: false };
    expect(deriveAuthState(lapsed, input({ signInError: true }))).toBe('signinFailed');
  });

  it('is "readonly" for a logged-in read-only user (ask admin — never re-auth)', () => {
    const ro = { ...writable, canWrite: false, loggedIn: true };
    expect(deriveAuthState(ro, input({ everLoggedIn: true }))).toBe('readonly');
  });

  it('is "reauth" when a previously-signed-in session has lapsed', () => {
    const lapsed = { ...writable, canWrite: false, loggedIn: false };
    expect(deriveAuthState(lapsed, input({ everLoggedIn: true }))).toBe('reauth');
  });

  it('is "signinRequired" for a cold, never-signed-in, not-authenticated load', () => {
    const cold = { ...writable, canWrite: false, loggedIn: false };
    expect(deriveAuthState(cold, input({ everLoggedIn: false }))).toBe('signinRequired');
  });

  it('routes an anonymous read-only session to sign-in (remedy = sign in, not ask admin)', () => {
    const anon = { ...writable, canWrite: false, loggedIn: false, anonymous: true };
    expect(deriveAuthState(anon, input())).toBe('signinRequired');
  });

  it('lets canWrite win over a mis-detected loggedIn=false (never trap a writable user)', () => {
    const odd = { ...writable, canWrite: true, loggedIn: false };
    expect(deriveAuthState(odd, input({ everLoggedIn: true }))).toBe('signedIn');
  });
});

describe('normalizeSession (tolerate an old plugin)', () => {
  it('passes the enriched fields straight through', () => {
    expect(
      normalizeSession({
        securityEnabled: true,
        authenticated: true,
        readOnly: false,
        loggedIn: true,
        canWrite: true,
        anonymous: false,
        username: 'skipper',
        userLevel: 'admin',
        pluginVersion: '2',
      }),
    ).toEqual({
      securityEnabled: true,
      loggedIn: true,
      canWrite: true,
      anonymous: false,
      username: 'skipper',
      userLevel: 'admin',
      pluginVersion: '2',
    });
  });

  it('derives loggedIn/canWrite from the old three booleans (secured + writable)', () => {
    expect(
      normalizeSession({
        securityEnabled: true,
        authenticated: true,
        readOnly: false,
        pluginVersion: '1',
      }),
    ).toMatchObject({ loggedIn: true, canWrite: true, anonymous: false });
  });

  it('derives canWrite=false for an old-plugin read-only principal', () => {
    expect(
      normalizeSession({
        securityEnabled: true,
        authenticated: true,
        readOnly: true,
        pluginVersion: '1',
      }),
    ).toMatchObject({ loggedIn: true, canWrite: false });
  });

  it('open server: loggedIn + canWrite true even from the old shape', () => {
    expect(
      normalizeSession({ securityEnabled: false, authenticated: true, pluginVersion: '1' }),
    ).toMatchObject({ loggedIn: true, canWrite: true });
  });

  it('secured + unauthenticated old shape: not logged in, cannot write', () => {
    expect(
      normalizeSession({ securityEnabled: true, authenticated: false, pluginVersion: '1' }),
    ).toMatchObject({ loggedIn: false, canWrite: false });
  });
});
