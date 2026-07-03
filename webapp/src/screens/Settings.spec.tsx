import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Settings } from './Settings';

const props = {
  theme: 'dark' as const,
  onTheme: vi.fn(),
  density: 'helm' as const,
  onDensity: vi.fn(),
};

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
    // This jsdom setup exposes no working localStorage (the prefs lib guards with try/catch);
    // stub an in-memory one so persistence is observable.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    render(<Settings {...props} />);
    const toggle = screen.getByRole('button', { name: 'Continuous PTZ: off' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Continuous PTZ: on' })).toBeTruthy();
    expect(store.get('sk-video.ptz-continuous')).toBe('true');
    vi.unstubAllGlobals();
  });
});
