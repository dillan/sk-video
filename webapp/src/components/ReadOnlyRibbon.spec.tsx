import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReadOnlyRibbon } from './ReadOnlyRibbon';

afterEach(cleanup);

describe('ReadOnlyRibbon', () => {
  it('states read-only access with the honest remedy (ask an admin, not sign in)', () => {
    render(<ReadOnlyRibbon />);
    expect(screen.getByText(/Read-only access/)).toBeTruthy();
    expect(screen.getByText(/Ask your Signal K administrator/)).toBeTruthy();
  });

  it('is a status region, not an alert (a lapse is informational, never a safety alarm)', () => {
    render(<ReadOnlyRibbon />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
