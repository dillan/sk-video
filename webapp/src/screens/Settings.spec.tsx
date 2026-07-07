import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

// Settings reads the auth posture (for the Session/sign-out panel) from the provider; mock it so the
// screen can render standalone and we can drive each posture.
const authMock = vi.hoisted(() => ({
  current: {
    state: 'open',
    session: { securityEnabled: false } as Record<string, unknown> | null,
    username: undefined as string | undefined,
    userLevel: undefined as string | undefined,
    signOut: vi.fn(),
  },
}));
vi.mock('../lib/auth', () => ({ useAuth: () => authMock.current }));

import { Settings } from './Settings';

const props = {
  theme: 'dark' as const,
  onTheme: vi.fn(),
  density: 'helm' as const,
  onDensity: vi.fn(),
};

beforeEach(() => {
  authMock.current = {
    state: 'open',
    session: { securityEnabled: false },
    username: undefined,
    userLevel: undefined,
    signOut: vi.fn(),
  };
});
afterEach(cleanup);

describe('Settings', () => {
  it('shows the theme options with the active one pressed', () => {
    render(<Settings {...props} theme="dark" />);
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('changes the theme when an option is tapped', () => {
    const onTheme = vi.fn();
    render(<Settings {...props} onTheme={onTheme} />);
    fireEvent.click(screen.getByRole('button', { name: 'Night-Red' }));
    expect(onTheme).toHaveBeenCalledWith('night');
  });

  it('shows the density options and changes density when tapped', () => {
    const onDensity = vi.fn();
    render(<Settings {...props} density="helm" onDensity={onDensity} />);
    expect(screen.getByRole('button', { name: 'Helm' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Desk' }));
    expect(onDensity).toHaveBeenCalledWith('desk');
  });

  it('renders the operational settings panel (now owned by the web app, not the SK admin)', () => {
    render(<Settings {...props} theme="night" />);
    // The panel heading is always present (it manages its own async config load internally).
    expect(screen.getByRole('heading', { name: 'Operational settings' })).toBeTruthy();
    // The Safety alerts panel is here too.
    expect(screen.getByRole('heading', { name: 'Safety alerts' })).toBeTruthy();
  });

  it('offers the continuous-PTZ opt-in, defaulting off and persisting per device', () => {
    render(<Settings {...props} />);
    const toggle = screen.getByRole('button', { name: 'Continuous PTZ: off' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Continuous PTZ: on' })).toBeTruthy();
    // Real (test-setup-provided) localStorage — the pref persists device-locally.
    expect(localStorage.getItem('sk-video.ptz-continuous')).toBe('true');
  });

  it('offers the tap-to-aim toggle, defaulting ON and persisting per device', () => {
    render(<Settings {...props} />);
    const toggle = screen.getByRole('button', { name: 'Tap to aim: on' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true'); // on by default
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Tap to aim: off' })).toBeTruthy();
    expect(localStorage.getItem('sk-video.ptz-tap-to-aim')).toBe('false');
  });

  it('hides the Session panel on an open server (no sign-in, nothing to sign out of)', () => {
    render(<Settings {...props} />);
    expect(screen.queryByRole('heading', { name: 'Session' })).toBeNull();
  });

  it('offers a low-prominence sign-out that confirms first (guards a mid-watch sign-out)', () => {
    const signOut = vi.fn();
    authMock.current = {
      state: 'signedIn',
      session: { securityEnabled: true },
      username: 'skipper',
      userLevel: 'admin',
      signOut,
    };
    render(<Settings {...props} />);
    expect(screen.getByRole('heading', { name: 'Session' })).toBeTruthy();
    expect(screen.getByText(/skipper/)).toBeTruthy();

    // Cancelling the confirm must NOT sign out.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Stay signed in' }),
    );
    expect(signOut).not.toHaveBeenCalled();

    // Confirming does.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sign out' }),
    );
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
