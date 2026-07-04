import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LiveWall } from './LiveWall';
import type { ILayoutGroup } from '../api';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

/** Mock the aggregate wall projection (`GET /plugins/sk-video/cameras`). */
function mockProjection(cameras: Record<string, unknown>, groups: ILayoutGroup[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      if (u.endsWith('/plugins/sk-video/cameras')) {
        const list = Object.entries(cameras)
          .map(([id, c]) => ({
            id,
            ...(c as Record<string, unknown>),
            safetyCritical: false,
            health: null,
            transport: null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return ok({ gatewayOnline: true, cameras: list, layout: { groups } });
      }
      return ok({});
    }),
  );
}

// Names deliberately differ from the mount subtitles ("Bow", "Stern") the tiles also render.
const THREE_CAMS = {
  bow: { name: 'Foredeck', enabled: true, placement: { mount: 'bow' } },
  stern: { name: 'Aftdeck', enabled: true, placement: { mount: 'stern' } },
  spare: { name: 'Spare', enabled: true }, // no placement → the server buckets it as Unplaced
};
const THREE_GROUPS: ILayoutGroup[] = [
  { key: 'all', label: 'All cameras', cameraIds: ['bow', 'stern', 'spare'] },
  { key: 'sector:forward', label: 'Forward', cameraIds: ['bow'] },
  { key: 'sector:aft', label: 'Aft', cameraIds: ['stern'] },
  { key: 'sector:unknown', label: 'Unplaced', cameraIds: ['spare'] },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LiveWall group chips', () => {
  it('renders a filter chip per layout group, plus an All-cameras reset', async () => {
    mockProjection(THREE_CAMS, THREE_GROUPS);
    render(<LiveWall onOpenCamera={() => undefined} />);
    await screen.findByText('Foredeck');
    const nav = screen.getByRole('navigation', { name: 'Camera groups' });
    expect(nav).toBeTruthy();
    for (const label of ['All cameras', 'Forward', 'Aft', 'Unplaced']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('filters the mosaic to the selected group and resets on All cameras', async () => {
    mockProjection(THREE_CAMS, THREE_GROUPS);
    render(<LiveWall onOpenCamera={() => undefined} />);
    await screen.findByText('Foredeck');
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByText('Foredeck')).toBeTruthy();
    expect(screen.queryByText('Aftdeck')).toBeNull();
    expect(screen.queryByText('Spare')).toBeNull();
    expect(screen.getByText(/^1 camera\b/)).toBeTruthy(); // the header count follows the filter
    fireEvent.click(screen.getByRole('button', { name: 'All cameras' }));
    expect(screen.getByText('Aftdeck')).toBeTruthy();
    expect(screen.getByText('Spare')).toBeTruthy();
  });

  it('shows the Unplaced group for a camera without a placement, and it filters', async () => {
    mockProjection(THREE_CAMS, THREE_GROUPS);
    render(<LiveWall onOpenCamera={() => undefined} />);
    await screen.findByText('Spare');
    fireEvent.click(screen.getByRole('button', { name: 'Unplaced' }));
    expect(screen.getByText('Spare')).toBeTruthy();
    expect(screen.queryByText('Foredeck')).toBeNull();
  });

  it('skips the chips when only the all group exists', async () => {
    mockProjection({ bow: { name: 'Bow', enabled: true } }, [
      { key: 'all', label: 'All cameras', cameraIds: ['bow'] },
    ]);
    render(<LiveWall onOpenCamera={() => undefined} />);
    await screen.findByText('Bow');
    expect(screen.queryByRole('navigation', { name: 'Camera groups' })).toBeNull();
  });

  it('skips the chips for a single real group (it would only mirror All cameras)', async () => {
    mockProjection({ bow: { name: 'Foredeck', enabled: true, placement: { mount: 'bow' } } }, [
      { key: 'all', label: 'All cameras', cameraIds: ['bow'] },
      { key: 'sector:forward', label: 'Forward', cameraIds: ['bow'] },
    ]);
    render(<LiveWall onOpenCamera={() => undefined} />);
    await screen.findByText('Foredeck');
    expect(screen.queryByRole('navigation', { name: 'Camera groups' })).toBeNull();
  });

  it('persists the picked group per device and restores it on the next visit (saved view)', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    mockProjection(THREE_CAMS, THREE_GROUPS);
    const first = render(<LiveWall onOpenCamera={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Forward' }));
    expect(store.get('sk-video.wall-group')).toBe('sector:forward');
    first.unmount();

    mockProjection(THREE_CAMS, THREE_GROUPS);
    render(<LiveWall onOpenCamera={() => undefined} />);
    // The restored view filters immediately: only the Forward camera is on the wall.
    await screen.findByText('Foredeck');
    expect(screen.queryByText('Aftdeck')).toBeNull();
    vi.unstubAllGlobals();
  });
});
