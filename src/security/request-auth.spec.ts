import { describe, it, expect } from 'vitest';
import { isAuthorizedSensitiveRequest } from './request-auth';

describe('isAuthorizedSensitiveRequest', () => {
  it('allows when the server exposes no security strategy (security not in play)', () => {
    expect(isAuthorizedSensitiveRequest(undefined, {})).toBe(true);
  });

  it('allows on an open server (dummy strategy = security disabled by the operator)', () => {
    expect(isAuthorizedSensitiveRequest({ isDummy: () => true }, {})).toBe(true);
  });

  it('allows a request carrying an authenticated principal', () => {
    const strat = { isDummy: () => false };
    expect(isAuthorizedSensitiveRequest(strat, { skPrincipal: { identifier: 'alice' } })).toBe(
      true,
    );
  });

  it('falls back to the strategy login check when there is no principal', () => {
    const loggedIn = { isDummy: () => false, getLoginStatus: () => ({ status: 'loggedIn' }) };
    const notLoggedIn = { isDummy: () => false, getLoginStatus: () => ({ status: 'notLoggedIn' }) };
    expect(isAuthorizedSensitiveRequest(loggedIn, {})).toBe(true);
    expect(isAuthorizedSensitiveRequest(notLoggedIn, {})).toBe(false);
  });

  it('denies a secured server when there is no principal and no login info', () => {
    expect(isAuthorizedSensitiveRequest({ isDummy: () => false }, {})).toBe(false);
  });

  it('denies (fails closed) when the strategy throws', () => {
    const strat = {
      isDummy: () => false,
      getLoginStatus: () => {
        throw new Error('boom');
      },
    };
    expect(isAuthorizedSensitiveRequest(strat, {})).toBe(false);
  });
});
