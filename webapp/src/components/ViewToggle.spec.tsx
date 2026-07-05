import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ViewToggle } from './ViewToggle';

afterEach(cleanup);

describe('ViewToggle', () => {
  it('marks the active mode pressed and reports a switch', () => {
    const onChange = vi.fn();
    render(<ViewToggle mode="grid" onChange={onChange} />);
    const grid = screen.getByRole('button', { name: /grid view/i });
    const list = screen.getByRole('button', { name: /list view/i });
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    expect(list.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(list);
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('does not re-fire when the active mode is clicked again', () => {
    const onChange = vi.fn();
    render(<ViewToggle mode="list" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /list view/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
