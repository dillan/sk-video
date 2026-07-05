import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const authMock = vi.hoisted(() => ({
  current: { signIn: vi.fn(), signInError: null as string | null, state: 'reauth' as string },
}));
vi.mock('../lib/auth', () => ({ useAuth: () => authMock.current }));

import { ReAuth } from './ReAuth';

beforeEach(() => {
  authMock.current = { signIn: vi.fn(), signInError: null, state: 'reauth' };
});
afterEach(cleanup);

describe('ReAuth (state 7)', () => {
  it('is a non-modal recovery form with reassuring copy', () => {
    render(<ReAuth />);
    expect(screen.getByRole('form', { name: /Re-authenticate/ })).toBeTruthy();
    expect(screen.getByText(/session expired/i)).toBeTruthy();
    expect(screen.getByText(/land right back here/i)).toBeTruthy();
  });

  it('does NOT autofocus — it must never steal the keyboard mid-watch', () => {
    render(<ReAuth />);
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText('Username'));
  });

  it('re-authenticates through the provider', () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    authMock.current = { signIn, signInError: null, state: 'reauth' };
    render(<ReAuth />);
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'skipper' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Re-authenticate' }));
    expect(signIn).toHaveBeenCalledWith('skipper', 'pw');
  });

  it('disables the form while signing in', () => {
    authMock.current = { signIn: vi.fn(), signInError: null, state: 'signingIn' };
    render(<ReAuth />);
    expect(
      (screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the provider error after a failed attempt', () => {
    authMock.current = {
      signIn: vi.fn(),
      signInError: 'Incorrect username or password.',
      state: 'signinFailed',
    };
    render(<ReAuth />);
    expect(screen.getByText('Incorrect username or password.')).toBeTruthy();
  });
});
