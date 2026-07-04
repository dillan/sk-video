import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('./Recordings', () => ({ Recordings: () => <div>RECORDINGS</div> }));
vi.mock('./Incidents', () => ({ Incidents: () => <div>INCIDENTS</div> }));
vi.mock('./Snapshots', () => ({ Snapshots: () => <div>SNAPSHOTS</div> }));
vi.mock('./Events', () => ({ Events: () => <div>EVENTS</div> }));
vi.mock('./Videos', () => ({ Videos: () => <div>VIDEOS</div> }));

import { Library } from './Library';

afterEach(cleanup);

describe('Library shell', () => {
  it('defaults to Recordings and reports tab changes', () => {
    const onTab = vi.fn();
    render(<Library onTab={onTab} />);
    expect(screen.getByText('RECORDINGS')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Incidents' }));
    expect(onTab).toHaveBeenCalledWith('incidents');
  });

  it('renders the tab named by the route', () => {
    render(<Library tab="videos" onTab={vi.fn()} />);
    expect(screen.getByText('VIDEOS')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Videos' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('renders the Snapshots tab', () => {
    render(<Library tab="snapshots" onTab={vi.fn()} />);
    expect(screen.getByText('SNAPSHOTS')).toBeTruthy();
  });

  it('renders the Events tab', () => {
    render(<Library tab="events" onTab={vi.fn()} />);
    expect(screen.getByText('EVENTS')).toBeTruthy();
  });
});
