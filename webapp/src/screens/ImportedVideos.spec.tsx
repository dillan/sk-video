import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { ImportedVideos } from './ImportedVideos';
import type { IVideoAsset } from '../api';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(videos: IVideoAsset[], opts: { uploadStatus?: number } = {}) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method });
      if (u.endsWith('/videos') && method === 'POST') {
        return opts.uploadStatus && opts.uploadStatus !== 201
          ? Promise.resolve({ ok: false, status: opts.uploadStatus })
          : ok({ id: 'v2', name: 'new.mp4', contentType: 'video/mp4', size: 100, createdAt: 0 });
      }
      if (u.includes('/videos/') && method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      if (u.endsWith('/videos')) return ok({ videos });
      return ok({});
    }),
  );
  return calls;
}

const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement;
const pick = (name: string) =>
  fireEvent.change(fileInput(), {
    target: { files: [new File([new Uint8Array([0, 0, 0, 1])], name, { type: 'video/mp4' })] },
  });

const V: IVideoAsset[] = [
  {
    id: 'v1',
    name: 'clip.mp4',
    contentType: 'video/mp4',
    size: 1536,
    createdAt: 1_700_000_000_000,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ImportedVideos', () => {
  it('lists stored videos with a human size', async () => {
    mockApi(V);
    render(<ImportedVideos />);
    await waitFor(() => expect(screen.getByText('clip.mp4')).toBeTruthy());
    expect(screen.getByText(/1\.5 KB/)).toBeTruthy();
  });

  it('shows an empty state when there are no videos', async () => {
    mockApi([]);
    render(<ImportedVideos />);
    await waitFor(() => expect(screen.getByText('No imported videos yet.')).toBeTruthy());
  });

  it('plays a video inline when Play is tapped', async () => {
    mockApi(V);
    render(<ImportedVideos />);
    await screen.findByText('clip.mp4');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(document.querySelector('video.vidrow__player')).toBeTruthy();
  });

  it('uploads a picked file and refreshes the list', async () => {
    const calls = mockApi(V);
    render(<ImportedVideos />);
    await screen.findByText('clip.mp4');
    pick('new.mp4');
    await waitFor(() => expect(screen.getByText(/Uploaded new\.mp4/)).toBeTruthy());
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/videos'))).toBe(true);
  });

  it('explains the quota error honestly on a 413 upload', async () => {
    mockApi(V, { uploadStatus: 413 });
    render(<ImportedVideos />);
    await screen.findByText('clip.mp4');
    pick('big.mp4');
    await waitFor(() => expect(screen.getByText(/exceed the storage quota/)).toBeTruthy());
  });

  it('deletes a video only after a confirm step', async () => {
    const calls = mockApi(V);
    render(<ImportedVideos />);
    await screen.findByText('clip.mp4');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});
