import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// SignIn drives the AuthProvider now; mock it so we can assert the wiring and render each posture.
const authMock = vi.hoisted(() => ({
  current: {
    signIn: vi.fn(),
    signInError: null as string | null,
    state: 'signinRequired' as string,
  },
}));
vi.mock('../lib/auth', () => ({ useAuth: () => authMock.current }));

import { SignIn } from './SignIn';

beforeEach(() => {
  authMock.current = { signIn: vi.fn(), signInError: null, state: 'signinRequired' };
});
afterEach(cleanup);

function fill(user: string, pass: string) {
  fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: user } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: pass } });
}

describe('SignIn', () => {
  it('signs in through the provider with the Signal K credentials', () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    authMock.current = { signIn, signInError: null, state: 'signinRequired' };
    render(<SignIn />);
    fill('skipper', 'hunter2');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalledWith('skipper', 'hunter2');
  });

  it('shows the provider’s sign-in error (state 6)', () => {
    authMock.current = {
      signIn: vi.fn(),
      signInError: 'Incorrect username or password.',
      state: 'signinFailed',
    };
    render(<SignIn />);
    expect(screen.getByText('Incorrect username or password.')).toBeTruthy();
  });

  it('disables the form while signing in — no double-submit (state 5)', () => {
    const signIn = vi.fn();
    authMock.current = { signIn, signInError: null, state: 'signingIn' };
    render(<SignIn />);
    const btn = screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect((screen.getByPlaceholderText('Username') as HTMLInputElement).disabled).toBe(true);
  });

  it('toggles password visibility', () => {
    render(<SignIn />);
    const pw = screen.getByPlaceholderText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw.type).toBe('text');
  });

  it('does not submit without a username', () => {
    const signIn = vi.fn();
    authMock.current = { signIn, signInError: null, state: 'signinRequired' };
    render(<SignIn />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).not.toHaveBeenCalled();
  });

  it('offers the low-prominence redirect fallback to Signal K', () => {
    render(<SignIn />);
    const link = screen.getByRole('link', { name: /Go to Signal K to sign in/ });
    expect(link.getAttribute('href')).toContain('/admin/#/login');
  });
});
