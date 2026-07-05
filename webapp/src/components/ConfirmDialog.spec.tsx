import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

const base = {
  title: 'Sign out of SK Video?',
  confirmLabel: 'Sign out',
  cancelLabel: 'Stay signed in',
};

describe('ConfirmDialog', () => {
  it('renders an alert dialog labelled by its title, with both actions', () => {
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alertdialog', { name: 'Sign out of SK Video?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stay signed in' })).toBeTruthy();
  });

  it('defaults focus to the safe (cancel) action so a stray Enter never confirms', () => {
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stay signed in' }));
  });

  it('calls onConfirm / onCancel from the matching buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape and on a backdrop click (but not a click inside the card)', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('alertdialog')); // inside the card — must NOT cancel
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('confirm-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('marks the confirm action destructive by default (red-tinted)', () => {
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign out' }).className).toContain('btn--danger');
  });
});
