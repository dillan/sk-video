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

  it('honestly signposts operational settings to the Signal K admin', () => {
    render(<Settings {...props} theme="night" />);
    expect(screen.getByText(/Server → Plugin Config → SK Video/)).toBeTruthy();
    expect(screen.getByText(/not a 24\/7 NVR/)).toBeTruthy();
  });
});
