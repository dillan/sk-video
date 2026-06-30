import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const api = vi.hoisted(() => ({ login: vi.fn(), fetchSession: vi.fn() }));
vi.mock('../api', () => api);

import { SignIn } from './SignIn';

beforeEach(() => {
  api.login.mockReset();
  api.fetchSession.mockReset();
});
afterEach(cleanup);

function fill(user: string, pass: string) {
  fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: user } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: pass } });
}

describe('SignIn', () => {
  it('signs in with Signal K credentials and reports the new session', async () => {
    api.login.mockResolvedValue(undefined);
    const session = { securityEnabled: true, authenticated: true, pluginVersion: '1' };
    api.fetchSession.mockResolvedValue(session);
    const onSignedIn = vi.fn();
    render(<SignIn onSignedIn={onSignedIn} />);
    fill('skipper', 'hunter2');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.login).toHaveBeenCalledWith('skipper', 'hunter2'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(session));
  });

  it('shows a friendly error and clears the password on bad credentials', async () => {
    api.login.mockRejectedValue(new Error('Incorrect username or password.'));
    render(<SignIn onSignedIn={vi.fn()} />);
    fill('skipper', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('Incorrect username or password.')).toBeTruthy());
    expect((screen.getByPlaceholderText('Password') as HTMLInputElement).value).toBe('');
  });

  it('toggles password visibility', () => {
    render(<SignIn onSignedIn={vi.fn()} />);
    const pw = screen.getByPlaceholderText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw.type).toBe('text');
  });

  it('does not submit without a username', () => {
    render(<SignIn onSignedIn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(api.login).not.toHaveBeenCalled();
  });
});
