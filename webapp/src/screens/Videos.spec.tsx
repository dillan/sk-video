import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { IVideoAsset } from '../api';

// Uploads ride the resumable transport (XHR + resume + retries), so it is mocked at the module
// seam; list/delete keep flowing through fetch stubs below.
const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/resumable-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/resumable-upload')>()),
  uploadVideoResumable: uploadMock,
}));

import { Videos } from './Videos';
import { ApiError } from '../api';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(videos: IVideoAsset[]) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method });
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
const mkFile = (name: string, size = 4): File =>
  new File([new Uint8Array(size)], name, { type: 'video/mp4' });
const pick = (...files: File[]) => fireEvent.change(fileInput(), { target: { files } });

/** An uploadVideo mock the test settles by hand, with access to each call's onBytes callback. */
function controllableUploads() {
  const started: {
    name: string;
    onBytes?: (sent: number) => void;
    resolve: () => void;
    reject: (e: unknown) => void;
  }[] = [];
  uploadMock.mockImplementation(
    (file: File, opts?: { onBytes?: (sent: number) => void }) =>
      new Promise((resolve, reject) => {
        started.push({
          name: file.name,
          onBytes: opts?.onBytes,
          resolve: () =>
            resolve({
              id: file.name,
              name: file.name,
              contentType: 'video/mp4',
              size: file.size,
              createdAt: 0,
            }),
          reject,
        });
      }),
  );
  return started;
}

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
  uploadMock.mockReset();
  vi.unstubAllGlobals();
});

describe('Videos', () => {
  it('lists stored videos with a human size', async () => {
    mockApi(V);
    render(<Videos />);
    await waitFor(() => expect(screen.getByText('clip.mp4')).toBeTruthy());
    expect(screen.getByText(/1\.5 KB/)).toBeTruthy();
    // The intro is honest about what uploaded clips are — no "arrives in later slices" leftovers.
    expect(screen.getByText(/separate from the DVR recordings and incident evidence/)).toBeTruthy();
    expect(screen.queryByText(/later slices/)).toBeNull();
  });

  it('shows an empty state when there are no videos', async () => {
    mockApi([]);
    render(<Videos />);
    await waitFor(() => expect(screen.getByText('No videos yet.')).toBeTruthy());
  });

  it('renders a grid of thumbnails labelled with filename, size, and date', async () => {
    mockApi([
      {
        id: 'v1',
        name: 'clip.mp4',
        contentType: 'video/mp4',
        size: 1536,
        createdAt: 1_700_000_000_000,
      },
    ]);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    const tile = document.querySelector('.vidtile');
    expect(tile).toBeTruthy();
    // The tile's thumbnail is a muted, inline <video> (so hover-preview is possible).
    const thumb = tile!.querySelector('video') as HTMLVideoElement;
    expect(thumb.muted).toBe(true);
    expect(thumb.getAttribute('src')).toContain('/videos/v1');
    // Label carries name + human size + a date.
    expect(tile!.textContent).toContain('clip.mp4');
    expect(tile!.textContent).toMatch(/1\.5 KB/);
    expect(tile!.textContent).toMatch(/\d{4}|\/|\d{1,2}/); // some rendered date
  });

  it('toggles between grid and list, keeps thumbnails in both, and remembers the choice', async () => {
    mockApi(V);
    const { unmount } = render(<Videos />);
    await screen.findByText('clip.mp4');
    expect(document.querySelector('.vidgrid')).toBeTruthy(); // grid by default

    fireEvent.click(screen.getByRole('button', { name: /list view/i }));
    expect(document.querySelector('.vidgrid')).toBeNull();
    const row = document.querySelector('.vidrow-thumb') as HTMLElement;
    expect(row).toBeTruthy();
    // The list row still carries a video thumbnail and the labels.
    expect(row.querySelector('video')).toBeTruthy();
    expect(row.textContent).toContain('clip.mp4');
    expect(localStorage.getItem('sk-video.view.videos')).toBe('list');

    // Re-mounting restores the list view.
    unmount();
    mockApi(V);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    expect(document.querySelector('.vidgrid')).toBeNull();
    expect(document.querySelector('.vidrow-thumb')).toBeTruthy();
  });

  it('opens the player from a list row and deletes from its trashcan', async () => {
    localStorage.setItem('sk-video.view.videos', 'list');
    const calls = mockApi(V);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    fireEvent.click(screen.getByRole('button', { name: /Play clip\.mp4/ }));
    expect(document.querySelector('.vidmodal video')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete clip.mp4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('opens a full player when a grid tile is clicked', async () => {
    mockApi(V);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    expect(document.querySelector('.vidmodal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Play clip\.mp4/ }));
    const player = document.querySelector('.vidmodal video') as HTMLVideoElement;
    expect(player).toBeTruthy();
    expect(player.getAttribute('src')).toContain('/videos/v1');
    expect(player.hasAttribute('controls')).toBe(true);
  });

  it('previews inline (muted) on hover and stops on leave', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    mockApi(V);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    const thumb = document.querySelector('.vidtile__thumb') as HTMLElement;
    fireEvent.mouseEnter(thumb);
    expect(play).toHaveBeenCalled();
    fireEvent.mouseLeave(thumb);
    expect(pause).toHaveBeenCalled();
  });

  it('accepts multiple files in one pick', async () => {
    mockApi(V);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    expect(fileInput().multiple).toBe(true);
  });

  it('uploads several files with live progress, then refreshes the list', async () => {
    mockApi(V);
    const started = controllableUploads();
    render(<Videos />);
    await screen.findByText('clip.mp4');

    pick(mkFile('a.mp4', 1000), mkFile('b.mp4', 1000));
    await waitFor(() => expect(started).toHaveLength(1)); // sequential: b waits for a

    // The progress panel is live: overall bar plus a row per file.
    expect(screen.getByRole('progressbar', { name: /upload progress/i })).toBeTruthy();
    expect(screen.getByText('a.mp4')).toBeTruthy();
    expect(screen.getByText('b.mp4')).toBeTruthy();

    started[0].onBytes?.(500);
    await waitFor(() =>
      expect(
        screen.getByRole('progressbar', { name: /upload progress/i }).getAttribute('aria-valuenow'),
      ).toBe('25'),
    );

    started[0].onBytes?.(1000);
    started[0].resolve();
    await waitFor(() => expect(started).toHaveLength(2));
    started[1].onBytes?.(1000);
    started[1].resolve();

    await waitFor(() => expect(screen.getByText(/Uploaded 2 videos\./)).toBeTruthy());
  });

  it('summarises a partial failure and names the reason per file', async () => {
    mockApi(V);
    const started = controllableUploads();
    render(<Videos />);
    await screen.findByText('clip.mp4');

    pick(mkFile('big.mp4', 1000), mkFile('ok.mp4', 1000));
    await waitFor(() => expect(started).toHaveLength(1));
    started[0].reject(new ApiError('upload failed (413)', 413));
    await waitFor(() => expect(started).toHaveLength(2));
    started[1].onBytes?.(1000);
    started[1].resolve();

    await waitFor(() => expect(screen.getByText(/Uploaded 1 of 2 — 1 failed\./)).toBeTruthy());
    expect(screen.getByText(/exceed the storage quota/)).toBeTruthy(); // on big.mp4's row
  });

  it('uploads a single picked file and reports it by name', async () => {
    mockApi(V);
    const started = controllableUploads();
    render(<Videos />);
    await screen.findByText('clip.mp4');
    pick(mkFile('new.mp4'));
    await waitFor(() => expect(started).toHaveLength(1));
    started[0].resolve();
    await waitFor(() => expect(screen.getByText(/Uploaded new\.mp4\./)).toBeTruthy());
  });

  it('starts a batch from files dragged and dropped anywhere on the screen', async () => {
    mockApi(V);
    const started = controllableUploads();
    const { container } = render(<Videos />);
    await screen.findByText('clip.mp4');

    const zone = container.firstElementChild as HTMLElement;
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    fireEvent.drop(zone, { dataTransfer: { files: [mkFile('dropped.mp4', 500)] } });

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0].name).toBe('dropped.mp4');
    expect(screen.getByRole('progressbar', { name: /upload progress/i })).toBeTruthy();
    started[0].resolve();
    await waitFor(() => expect(screen.getByText(/Uploaded dropped\.mp4\./)).toBeTruthy());
  });

  it('offers Retry on a failed file and retries exactly that file', async () => {
    mockApi(V);
    const started = controllableUploads();
    render(<Videos />);
    await screen.findByText('clip.mp4');

    pick(mkFile('flaky.mp4', 1000));
    await waitFor(() => expect(started).toHaveLength(1));
    started[0].reject(new ApiError('upload failed (network)', 0));
    await waitFor(() => expect(screen.getByText(/Uploaded 0 of 1 — 1 failed\./)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Retry flaky.mp4' }));
    await waitFor(() => expect(started).toHaveLength(2));
    expect(started[1].name).toBe('flaky.mp4');
    started[1].resolve();
    await waitFor(() => expect(screen.getByText(/Uploaded flaky\.mp4\./)).toBeTruthy());
  });

  it('deletes a video from the trashcan only after a confirm step', async () => {
    const calls = mockApi(V);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    // The red trashcan asks first — no DELETE until the confirmation is accepted.
    fireEvent.click(screen.getByRole('button', { name: 'Delete clip.mp4' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('cancels a delete without removing the video', async () => {
    const calls = mockApi(V);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    fireEvent.click(screen.getByRole('button', { name: 'Delete clip.mp4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByText('clip.mp4')).toBeTruthy();
  });

  it('tapping the trashcan does not open the player', async () => {
    mockApi(V);
    render(<Videos />);
    await screen.findByText('clip.mp4');
    fireEvent.click(screen.getByRole('button', { name: 'Delete clip.mp4' }));
    expect(document.querySelector('.vidmodal')).toBeNull(); // confirm shown, not playback
  });
});
