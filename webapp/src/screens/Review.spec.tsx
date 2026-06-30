import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('./Recordings', () => ({ Recordings: () => <div>RECORDINGS</div> }));
vi.mock('./Incidents', () => ({ Incidents: () => <div>INCIDENTS</div> }));
vi.mock('./Snapshots', () => ({ Snapshots: () => <div>SNAPSHOTS</div> }));
vi.mock('./ImportedVideos', () => ({ ImportedVideos: () => <div>IMPORTED</div> }));

import { Review } from './Review';

afterEach(cleanup);

describe('Review shell', () => {
  it('defaults to Recordings and reports tab changes', () => {
    const onTab = vi.fn();
    render(<Review onTab={onTab} />);
    expect(screen.getByText('RECORDINGS')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Incidents' }));
    expect(onTab).toHaveBeenCalledWith('incidents');
  });

  it('renders the tab named by the route', () => {
    render(<Review tab="imported" onTab={vi.fn()} />);
    expect(screen.getByText('IMPORTED')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Imported' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('renders the Snapshots tab', () => {
    render(<Review tab="snapshots" onTab={vi.fn()} />);
    expect(screen.getByText('SNAPSHOTS')).toBeTruthy();
  });
});
