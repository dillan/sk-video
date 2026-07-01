import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { GlassMenu, type IMenuRow } from './GlassMenu';

afterEach(cleanup);

function setup(over: Partial<IMenuRow>[] = []) {
  const merged: IMenuRow[] = [
    { key: 'a', label: 'Alpha', active: true, onSelect: vi.fn(), ...over[0] },
    { key: 'b', label: 'Bravo', sub: 'h264', onSelect: vi.fn(), ...over[1] },
  ];
  render(
    <GlassMenu
      title="Pick"
      trigger={(open, toggle) => (
        <button type="button" aria-label="Open" aria-expanded={open} onClick={toggle}>
          trigger
        </button>
      )}
      rows={merged}
    />,
  );
  return merged;
}

describe('GlassMenu', () => {
  it('is closed until the trigger is tapped, then shows the rows', () => {
    setup();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /Alpha/ })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /Bravo/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('marks the active row checked', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('menuitemradio', { name: /Alpha/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('selecting a row fires onSelect and closes the menu', () => {
    const merged = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bravo/ }));
    expect(merged[1].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('dismisses on tap-away', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not fire a disabled row', () => {
    const merged = setup([{}, { disabled: true }]);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bravo/ }));
    expect(merged[1].onSelect).not.toHaveBeenCalled();
  });
});
