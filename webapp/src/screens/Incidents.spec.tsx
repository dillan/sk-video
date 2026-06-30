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
  },
];

function mockApi(opts: { deleteStatus?: number } = {}) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method });
      if (/\/incidents\/[^/]+$/.test(u) && method === 'PATCH') return ok({});
      if (/\/incidents\/[^/]+$/.test(u) && method === 'DELETE') {
        return opts.deleteStatus
          ? bad(opts.deleteStatus)
          : Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      if (/\/incidents\/[^/]+$/.test(u)) return ok(DETAIL);
      if (u.endsWith('/incidents')) return ok({ incidents: LIST });
      return ok({});
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Incidents', () => {
  it('lists bundles with their status pill', async () => {
    mockApi();
    render(<Incidents />);
    await waitFor(() => expect(screen.getByText('PARTIAL')).toBeTruthy());
    expect(screen.getByText(/bow, stern/)).toBeTruthy();
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
