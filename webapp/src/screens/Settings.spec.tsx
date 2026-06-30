import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Settings } from './Settings';

afterEach(cleanup);

describe('Settings', () => {
  it('shows the theme options with the active one pressed', () => {
    render(<Settings theme="dark" onTheme={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Night-Red' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('changes the theme when an option is tapped', () => {
    const onTheme = vi.fn();
    render(<Settings theme="dark" onTheme={onTheme} />);
    fireEvent.click(screen.getByRole('button', { name: 'Night-Red' }));
    expect(onTheme).toHaveBeenCalledWith('night');
  });

  it('honestly signposts operational settings to the Signal K admin', () => {
    render(<Settings theme="night" onTheme={vi.fn()} />);
    expect(screen.getByText(/Server → Plugin Config → SK Video/)).toBeTruthy();
    expect(screen.getByText(/not a 24\/7 NVR/)).toBeTruthy();
  });
});
