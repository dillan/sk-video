import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CameraControls } from './CameraControls';
import type { ICameraEntry } from '../api';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(over: (u: string, i?: RequestInit) => unknown | undefined = () => undefined) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    const custom = over(u, init);
    if (custom !== undefined) return custom;
    if (u.includes('/ptz/presets')) return ok([{ token: '1', name: 'Dock approach' }]);
    if (u.includes('/ptz/position')) return ok({ zoom: 0.24 });
    if (u.includes('/snapshot')) return ok({ hasFix: false });
    if (u.includes('/record')) return ok({ recording: true });
    if (u.includes('/imaging')) return ok({});
    if (u.includes('/ptz'))
      return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const camera = (caps: Record<string, boolean> = { ptz: true }): ICameraEntry =>
  ({ id: 'cam', name: 'Foredeck', capabilities: caps }) as unknown as ICameraEntry;

const base = {
  cameraId: 'cam',
  formFactor: 'tablet' as const,
  padSize: 104,
  rung: 'webrtc' as const,
  delayed: false,
  variant: 'main' as const,
  hasSub: false,
  mainIsHevc: false,
  onVariant: vi.fn(),
  onBack: vi.fn(),
  live: true,
  flash: vi.fn(),
  onPtzActivity: vi.fn(),
  listening: false,
  onListen: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CameraControls', () => {
  it('applies a vision mode (imaging preset) from the popover', async () => {
    const fetchMock = mockApi();
    render(<CameraControls {...base} camera={camera()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Vision mode' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Night/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/imaging') && i?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({
        preset: 'night',
      });
    });
  });

  it('lists PTZ presets and recalls one', async () => {
    const fetchMock = mockApi();
    render(<CameraControls {...base} camera={camera()} />);
    fireEvent.click(screen.getByRole('button', { name: 'PTZ presets' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Dock approach/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/ptz/preset') && i?.method === 'POST',
      );
      expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({ token: '1' });
    });
  });

  it('reports an honest no-GPS-fix snapshot result', async () => {
    const flash = vi.fn();
    mockApi();
    render(<CameraControls {...base} camera={camera()} flash={flash} />);
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    await waitFor(() =>
      expect(flash).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringMatching(/no GPS fix/) }),
      ),
    );
  });

  it('shows the audio "Listen" capability only when the camera reports audio, and toggles it', async () => {
    const onListen = vi.fn();
    mockApi();
    const { rerender } = render(
      <CameraControls {...base} camera={camera({ ptz: true })} onListen={onListen} />,
    );
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull(); // no audio cap → not shown
    rerender(
      <CameraControls {...base} camera={camera({ ptz: true, audio: true })} onListen={onListen} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(onListen).toHaveBeenCalledWith(true);
  });

  it('offers two-way audio only when the camera reports an audio backchannel', () => {
    mockApi();
    const { rerender } = render(<CameraControls {...base} camera={camera({ ptz: true })} />);
    expect(screen.queryByRole('button', { name: 'Two-way audio' })).toBeNull();
    rerender(<CameraControls {...base} camera={camera({ ptz: true, audioBackchannel: true })} />);
    expect(screen.getByRole('button', { name: 'Two-way audio' })).toBeTruthy();
  });

  it('shows spotlight/alarm only when the camera reports the aux capability', () => {
    mockApi();
    const { rerender } = render(
      <CameraControls {...base} camera={camera({ ptz: true, audio: true })} />,
    );
    expect(screen.queryByRole('button', { name: 'Spotlight' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Alarm' })).toBeNull();
    rerender(
      <CameraControls {...base} camera={camera({ ptz: true, spotlight: true, alarm: true })} />,
    );
    expect(screen.getByRole('button', { name: 'Spotlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alarm' })).toBeTruthy();
  });

  it('toggles the spotlight aux command', async () => {
    const fetchMock = mockApi();
    render(<CameraControls {...base} camera={camera({ ptz: true, spotlight: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Spotlight' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/spotlight') && i?.method === 'POST',
      );
      expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({ on: true });
    });
  });

  it('confirms before sounding the audible alarm', async () => {
    const fetchMock = mockApi();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CameraControls {...base} camera={camera({ ptz: true, alarm: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alarm' }));
    expect(confirm).toHaveBeenCalled();
    // Declined → no alarm command sent.
    await Promise.resolve();
    expect(
      fetchMock.mock.calls.some(([u, i]) => String(u).includes('/alarm') && i?.method === 'POST'),
    ).toBe(false);
  });

  it('disables the aim + zoom on a still-refresh feed and explains it', () => {
    mockApi();
    render(<CameraControls {...base} camera={camera()} delayed rung="mjpeg" />);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/still-refresh ~1 fps — PTZ paused/)).toBeTruthy();
  });

  it('phone layout drops STOP and folds vision + capabilities into the "…" menu', async () => {
    mockApi();
    render(
      <CameraControls
        {...base}
        camera={camera({ ptz: true, audio: true })}
        formFactor="phone"
        padSize={88}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Stop camera movement' })).toBeNull(); // no STOP on phone
    fireEvent.click(screen.getByRole('button', { name: 'More controls' }));
    expect(await screen.findByRole('menuitemradio', { name: /Auto/ })).toBeTruthy(); // vision folded in
    expect(screen.getByText('Listen')).toBeTruthy(); // capability folded in
  });
});
