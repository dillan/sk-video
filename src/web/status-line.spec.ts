import { describe, it, expect } from 'vitest';
import { statusLine } from './status-line';

describe('statusLine', () => {
  it('summarises cameras, live feeds, and the tier in one admin-readable line', () => {
    expect(statusLine({ cameras: 4, streaming: 3, dark: 0, tier: 'pi4' })).toBe(
      'Ready — 4 cameras · 3 streaming · pi4',
    );
  });

  it('calls out dark cameras so the dashboard shows trouble at a glance', () => {
    expect(statusLine({ cameras: 4, streaming: 2, dark: 1, tier: 'pi4' })).toBe(
      'Ready — 4 cameras · 2 streaming · 1 dark · pi4',
    );
  });

  it('keeps the degenerate cases readable', () => {
    expect(statusLine({ cameras: 0, streaming: 0, dark: 0 })).toBe('Ready — 0 cameras');
    expect(statusLine({ cameras: 1, streaming: 1, dark: 0 })).toBe(
      'Ready — 1 camera · 1 streaming',
    );
  });
});
