import { describe, it, expect } from 'vitest';
import {
  isAuthorizedSensitiveRequest,
  isSecurityEnabled,
  principalPermissions,
  isReadOnlyPrincipal,
  principalIdentifier,
  isLoggedInPrincipal,
  isAnonymousPrincipal,
  canWriteRequest,
} from './request-auth';

describe('isSecurityEnabled', () => {
  it('is false when no strategy is present (security not configured)', () => {
    expect(isSecurityEnabled(undefined)).toBe(false);
  });
  it('is false on the open/dummy strategy', () => {
    expect(isSecurityEnabled({ isDummy: () => true })).toBe(false);
  });
  it('is true for a real strategy', () => {
    expect(isSecurityEnabled({ isDummy: () => false })).toBe(true);
    expect(isSecurityEnabled({})).toBe(true); // a strategy with no isDummy is a real one
  });
  it('treats a throwing isDummy as secured (fails to the safe side)', () => {
    expect(
      isSecurityEnabled({
        isDummy: () => {
          throw new Error('boom');
        },
      }),
    ).toBe(true);
  });
});

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

  it('denies (fails closed) when isDummy throws on a secured server', () => {
    const strat = {
      isDummy: () => {
        throw new Error('boom');
      },
    };
    expect(isAuthorizedSensitiveRequest(strat, {})).toBe(false);
  });

  it('still allows an authenticated principal even if isDummy throws', () => {
    const strat = {
      isDummy: () => {
        throw new Error('boom');
      },
    };
    expect(isAuthorizedSensitiveRequest(strat, { skPrincipal: { identifier: 'alice' } })).toBe(
      true,
    );
  });
});

describe('principal permissions (readonly refinement)', () => {
  it('reads a string permissions field off the principal, else reports unknown', () => {
    expect(principalPermissions({ skPrincipal: { permissions: 'readonly' } })).toBe('readonly');
    expect(principalPermissions({ skPrincipal: { permissions: 'admin' } })).toBe('admin');
    expect(principalPermissions({ skPrincipal: {} })).toBeNull();
    expect(principalPermissions({ skPrincipal: 'user' })).toBeNull();
    expect(principalPermissions({})).toBeNull();
  });

  it('flags ONLY a known-readonly principal (unknown shapes must never deny writes)', () => {
    expect(isReadOnlyPrincipal({ skPrincipal: { permissions: 'readonly' } })).toBe(true);
    expect(isReadOnlyPrincipal({ skPrincipal: { permissions: 'readwrite' } })).toBe(false);
    expect(isReadOnlyPrincipal({ skPrincipal: {} })).toBe(false);
    expect(isReadOnlyPrincipal({})).toBe(false);
  });
});

describe('principalIdentifier', () => {
  it('reads identifier (or id) off the principal, else null', () => {
    expect(principalIdentifier({ skPrincipal: { identifier: 'alice' } })).toBe('alice');
    expect(principalIdentifier({ skPrincipal: { id: 'bob' } })).toBe('bob');
    expect(principalIdentifier({ skPrincipal: { identifier: 'AUTO' } })).toBe('AUTO');
    expect(principalIdentifier({ skPrincipal: {} })).toBeNull();
    expect(principalIdentifier({})).toBeNull();
  });
});

describe('isLoggedInPrincipal (a real login, not the anonymous AUTO principal)', () => {
  const secured = { isDummy: () => false };
  it('is true on an open server (nothing to log into)', () => {
    expect(isLoggedInPrincipal(undefined, {})).toBe(true);
    expect(isLoggedInPrincipal({ isDummy: () => true }, {})).toBe(true);
  });
  it('is true when the strategy reports a logged-in status', () => {
    const strat = { isDummy: () => false, getLoginStatus: () => ({ status: 'loggedIn' }) };
    expect(isLoggedInPrincipal(strat, {})).toBe(true);
  });
  it('is true for a named principal even without getLoginStatus', () => {
    expect(
      isLoggedInPrincipal(secured, {
        skPrincipal: { identifier: 'alice', permissions: 'readonly' },
      }),
    ).toBe(true);
  });
  it('is FALSE for the anonymous AUTO readonly principal (allow_readonly)', () => {
    expect(
      isLoggedInPrincipal(secured, {
        skPrincipal: { identifier: 'AUTO', permissions: 'readonly' },
      }),
    ).toBe(false);
  });
  it('is false for an unauthenticated request', () => {
    expect(isLoggedInPrincipal(secured, {})).toBe(false);
  });
  it('fails closed when getLoginStatus throws and no usable principal', () => {
    const strat = {
      isDummy: () => false,
      getLoginStatus: () => {
        throw new Error('boom');
      },
    };
    expect(isLoggedInPrincipal(strat, {})).toBe(false);
  });
});

describe('isAnonymousPrincipal (the AUTO readonly principal)', () => {
  const secured = { isDummy: () => false };
  it('is false on an open server (no anonymous-vs-login distinction)', () => {
    expect(isAnonymousPrincipal(undefined, { skPrincipal: { identifier: 'AUTO' } })).toBe(false);
  });
  it('is true for the AUTO principal', () => {
    expect(
      isAnonymousPrincipal(secured, {
        skPrincipal: { identifier: 'AUTO', permissions: 'readonly' },
      }),
    ).toBe(true);
  });
  it('is false for a named logged-in readonly user (ask-admin, not anonymous)', () => {
    expect(
      isAnonymousPrincipal(secured, {
        skPrincipal: { identifier: 'guest', permissions: 'readonly' },
      }),
    ).toBe(false);
  });
  it('is false for a writable principal', () => {
    expect(
      isAnonymousPrincipal(secured, {
        skPrincipal: { identifier: 'alice', permissions: 'readwrite' },
      }),
    ).toBe(false);
  });
});

describe('canWriteRequest (the single write gate)', () => {
  const secured = { isDummy: () => false };
  it('allows writes on an open server', () => {
    expect(canWriteRequest(undefined, {})).toBe(true);
  });
  it('allows an admin or readwrite principal', () => {
    expect(canWriteRequest(secured, { skPrincipal: { permissions: 'admin' } })).toBe(true);
    expect(canWriteRequest(secured, { skPrincipal: { permissions: 'readwrite' } })).toBe(true);
  });
  it('denies a known-readonly principal', () => {
    expect(canWriteRequest(secured, { skPrincipal: { permissions: 'readonly' } })).toBe(false);
  });
  it('denies an unauthenticated request', () => {
    expect(canWriteRequest(secured, {})).toBe(false);
  });
  it('allows an authenticated principal of unknown permission shape (only certainty denies)', () => {
    expect(canWriteRequest(secured, { skPrincipal: { identifier: 'alice' } })).toBe(true);
  });
});
