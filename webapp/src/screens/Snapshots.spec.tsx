import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Snapshots } from './Snapshots';
import type { ISnapshot } from '../api';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockSnaps(snapshots: ISnapshot[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => ok({ snapshots })),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SNAPS: ISnapshot[] = [
  {
    id: 's1',
    cameraId: 'bow',
    createdAt: 1,
    size: 100,
    telemetry: { positionAvailable: false, position: null },
  },
  {
    id: 's2',
    cameraId: 'stern',
    createdAt: 2,
    size: 100,
    telemetry: { positionAvailable: true, position: { latitude: 37.5, longitude: -76.3 } },
  },
];

describe('Snapshots', () => {
  it('shows the gallery and is honest about a missing GPS fix', async () => {
    mockSnaps(SNAPS);
    render(<Snapshots />);
    await waitFor(() => expect(screen.getByText('bow')).toBeTruthy());
    expect(screen.getByText('stern')).toBeTruthy();
    // s1 had no fix → honest "No GPS fix"; s2 had one → no such badge on its tile
    expect(screen.getByText('No GPS fix')).toBeTruthy();
    // each snapshot renders an <img> pointing at its blob url
    expect(document.querySelectorAll('img.snap__img').length).toBe(2);
  });

  it('shows an honest empty state', async () => {
    mockSnaps([]);
    render(<Snapshots />);
    await waitFor(() => expect(screen.getByText('No snapshots yet.')).toBeTruthy());
  });
});
