import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const authMock = vi.hoisted(() => ({
  current: { state: 'checking' as string, username: undefined as string | undefined },
}));
vi.mock('../lib/auth', () => ({ useAuth: () => authMock.current }));

import { AuthChip } from './AuthChip';

beforeEach(() => {
  authMock.current = { state: 'checking', username: undefined };
});
afterEach(cleanup);

function chip() {
  return screen.getByTitle('Authentication');
}

describe('AuthChip', () => {
  it('open server → green "Open server"', () => {
    authMock.current = { state: 'open', username: undefined };
    render(<AuthChip />);
    expect(chip().textContent).toContain('Open server');
    expect(chip().className).toContain('chip--online');
  });

  it('signed in → neutral chip naming the user with full control', () => {
    authMock.current = { state: 'signedIn', username: 'skipper' };
    render(<AuthChip />);
    expect(chip().textContent).toContain('skipper · full control');
    expect(chip().className).toContain('chip--neutral');
  });

  it('read-only → amber "Read-only"', () => {
    authMock.current = { state: 'readonly', username: 'guest' };
    render(<AuthChip />);
    expect(chip().textContent).toContain('Read-only');
    expect(chip().className).toContain('chip--caution');
  });

  it('sign-in required → blue "Sign in required"', () => {
    authMock.current = { state: 'signinRequired', username: undefined };
    render(<AuthChip />);
    expect(chip().textContent).toContain('Sign in required');
    expect(chip().className).toContain('chip--info');
  });

  it('re-auth → amber "Session expired"', () => {
    authMock.current = { state: 'reauth', username: undefined };
    render(<AuthChip />);
    expect(chip().textContent).toContain('Session expired');
    expect(chip().className).toContain('chip--caution');
  });

  it('unreachable → slate "Offline"', () => {
    authMock.current = { state: 'unreachable', username: undefined };
    render(<AuthChip />);
    expect(chip().textContent).toContain('Offline');
    expect(chip().className).toContain('chip--offline');
  });

  it('checking → neutral "Checking session…"', () => {
    render(<AuthChip />);
    expect(chip().textContent).toContain('Checking session');
    expect(chip().className).toContain('chip--neutral');
  });
});
