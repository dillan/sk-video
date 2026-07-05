import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Incidents } from './Incidents';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });
const bad = (status: number) => Promise.resolve({ ok: false, status, json: async () => ({}) });

const DETAIL = {
  id: 'inc1',
  status: 'partial',
  createdAt: 1,
  finalizedAt: 2,
  evidence: 'best-effort',
  cameras: ['bow', 'stern'],
  assets: [
    {
      id: 'a1',
      kind: 'clip',
      cameraId: 'bow',
      contentType: 'video/mp4',
      size: 1000,
      sha256: 'abcdef0123456789',
      name: 'bow.mp4',
      createdAt: 1,
    },
  ],
  failures: [{ kind: 'clip', cameraId: 'stern', reason: 'no DVR segments overlapped the window' }],
  digest: { algo: 'sha256', value: 'x' },
  telemetry: { coversPreRoll: false },
  trigger: { source: 'manual', firedAt: 100_000 },
  window: { preMs: 30_000, postMs: 60_000 },
  pinned: false,
};
const LIST = [
  {
    id: 'inc1',
    status: 'partial',
    createdAt: 1,
    finalizedAt: 2,
    cameras: ['bow', 'stern'],
    pinned: false,
    assetCount: 1,
    failureCount: 1,
    posterAssetId: 'a1',
  },
];

/**
 * Flexible fetch stub. Pass nothing for the defaults; `{ deleteStatus }` to force a delete
 * response; a bundle-shaped object (has an `id`) to override the DETAIL response; or an array to
 * override the LIST response.
 */
function mockApi(arg: unknown = {}) {
  const isArray = Array.isArray(arg);
  const obj = (isArray ? {} : (arg as Record<string, unknown>)) ?? {};
  const list = isArray ? (arg as unknown[]) : LIST;
  const detail = !isArray && 'id' in obj ? obj : DETAIL;
  const deleteStatus = obj.deleteStatus as number | undefined;
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method });
      if (/\/incidents\/[^/]+$/.test(u) && method === 'PATCH') return ok({});
      if (/\/incidents\/[^/]+$/.test(u) && method === 'DELETE') {
        return deleteStatus
          ? bad(deleteStatus)
          : Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      if (/\/incidents\/[^/]+$/.test(u)) return ok(detail);
      if (u.endsWith('/incidents')) return ok({ incidents: list });
      return ok({});
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers(); // a failed fake-timer test must not starve the rest of the file
  try {
    localStorage.clear(); // the view-mode preference must not leak across tests
  } catch {
    /* jsdom localStorage may be unavailable */
  }
});

describe('Incidents', () => {
  it('lists bundles with their status pill', async () => {
    mockApi();
    render(<Incidents />);
    await waitFor(() => expect(screen.getByText('PARTIAL')).toBeTruthy());
    expect(screen.getByText(/bow, stern/)).toBeTruthy();
  });

  it('defaults to a grid of poster thumbnails and toggles to a list, remembering the choice', async () => {
    // This jsdom setup has no working localStorage; stub one so the persistence is observable.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    mockApi();
    const { unmount } = render(<Incidents />);
    await waitFor(() => expect(screen.getByText('PARTIAL')).toBeTruthy());
    // Default is the grid, and the bundle's poster asset drives the thumbnail.
    expect(document.querySelector('.inc-grid')).toBeTruthy();
    const poster = document.querySelector('.inctile__thumb img') as HTMLImageElement;
    expect(poster.getAttribute('src')).toContain('/incidents/inc1/assets/a1');

    // Switch to the list view — persisted per view under its own key.
    fireEvent.click(screen.getByRole('button', { name: /list view/i }));
    expect(document.querySelector('.inc-grid')).toBeNull();
    expect(document.querySelector('.vidlist')).toBeTruthy();
    expect(store.get('sk-video.view.incidents')).toBe('list');

    // Re-mounting (navigating back) restores the last-used list view.
    unmount();
    mockApi();
    render(<Incidents />);
    await waitFor(() => expect(screen.getByText('PARTIAL')).toBeTruthy());
    expect(document.querySelector('.vidlist')).toBeTruthy();
    expect(document.querySelector('.inc-grid')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows a placeholder tile when a bundle has no poster asset', async () => {
    mockApi([{ ...LIST[0], posterAssetId: undefined, assetCount: 0 }]);
    render(<Incidents />);
    await waitFor(() => expect(screen.getByText('PARTIAL')).toBeTruthy());
    expect(document.querySelector('.inctile__thumb img')).toBeNull();
    expect(document.querySelector('.inctile__noposter')).toBeTruthy();
  });

  it('opens a bundle showing assets, the failures, and the honest copy', async () => {
    mockApi();
    render(<Incidents />);
    await waitFor(() => expect(screen.getByText('PARTIAL')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /bow, stern/ }));
    await waitFor(() => expect(screen.getByText(/no DVR segments overlapped/)).toBeTruthy());
    expect(screen.getByText(/file-integrity check, not/)).toBeTruthy();
    expect(screen.getByText(/clip · bow/)).toBeTruthy();
  });

  it('shows an inline thumbnail on each detail asset row (clip frame, snapshot image)', async () => {
    mockApi({
      ...DETAIL,
      assets: [
        DETAIL.assets[0], // a clip
        {
          id: 's1',
          kind: 'snapshot',
          cameraId: 'bow',
          contentType: 'image/jpeg',
          size: 500,
          sha256: 'deadbeef',
          name: 'bow.jpg',
          createdAt: 1,
        },
      ],
    });
    render(<Incidents />);
    await waitFor(() => expect(screen.getByText('PARTIAL')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /bow, stern/ }));
    await waitFor(() => expect(screen.getByText(/clip · bow/)).toBeTruthy());
    // The clip's row carries a <video> thumbnail; the snapshot's an <img> — both pointing at the asset.
    const clipThumb = document.querySelector('.asset__thumb video') as HTMLVideoElement;
    const snapThumb = document.querySelector('.asset__thumb img') as HTMLImageElement;
    expect(clipThumb.getAttribute('src')).toContain('/assets/a1');
    expect(snapThumb.getAttribute('src')).toContain('/assets/s1');
  });

  it('shows the requested-vs-actual capture span in the detail view', async () => {
    // The clip actually covers less than requested — the span row says so plainly.
    const withCoverage = {
      ...DETAIL,
      assets: [
        {
          ...DETAIL.assets[0],
          coverage: {
            actualStartMs: 80_000,
            actualEndMs: 140_000,
            contiguous: true,
            segmentCount: 2,
          },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        /\/incidents\/[^/]+$/.test(String(url)) ? ok(withCoverage) : ok({ incidents: LIST }),
      ),
    );
    render(<Incidents />);
    fireEvent.click(await screen.findByRole('button', { name: /bow, stern/ }));
    await waitFor(() => expect(screen.getByText(/Requested /)).toBeTruthy());
    expect(screen.getByText(/captured /)).toBeTruthy();
  });

  it('polls a capturing bundle until it settles (status reconciled without a manual reload)', async () => {
    vi.useFakeTimers();
    let phase = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = String(url);
        if (/\/incidents\/[^/]+$/.test(u)) {
          phase += 1;
          return ok({ ...DETAIL, status: phase < 2 ? 'capturing' : 'partial' });
        }
        return ok({ incidents: LIST });
      }),
    );
    render(<Incidents />);
    const { act } = await import('@testing-library/react');
    // resolve the list + open the detail
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: /bow, stern/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Capturing…')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3100);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Both the status pill and the failures chip say PARTIAL once settled.
    expect(screen.getAllByText(/PARTIAL/).length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('pins a bundle (PATCH)', async () => {
    const calls = mockApi();
    render(<Incidents />);
    await waitFor(() => screen.getByText('PARTIAL'));
    fireEvent.click(screen.getByRole('button', { name: /bow, stern/ }));
    await waitFor(() => screen.getByRole('button', { name: 'Pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  });

  it('offers an Export .zip download link pointing at the export endpoint', async () => {
    mockApi();
    render(<Incidents />);
    await waitFor(() => screen.getByText('PARTIAL'));
    fireEvent.click(screen.getByRole('button', { name: /bow, stern/ }));
    const link = await waitFor(() => screen.getByRole('link', { name: /Export \.zip/ }));
    expect(link.getAttribute('href')).toContain('/incidents/');
    expect(link.getAttribute('href')).toContain('/export.zip');
  });

  it('refuses to delete a pinned bundle (409) with honest copy', async () => {
    mockApi({ deleteStatus: 409 });
    render(<Incidents />);
    await waitFor(() => screen.getByText('PARTIAL'));
    fireEvent.click(screen.getByRole('button', { name: /bow, stern/ }));
    await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(screen.getByText(/unpin it before deleting/)).toBeTruthy());
  });
});
