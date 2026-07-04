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
  forcedTransport: null,
  onForceTransport: vi.fn(),
  continuousPan: false,
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

  it('keeps discrete nudge + zoom usable on a still-refresh feed, blocking only continuous pan', () => {
    // Continuous drag against a ~1 fps feed is dangerous (you steer blind between frames), but a
    // one-shot nudge is safe — and it drives the fast MJPEG refresh, which is unreachable if all
    // PTZ is disabled on this rung.
    mockApi();
    render(<CameraControls {...base} camera={camera()} delayed rung="mjpeg" />);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByText(/still-refresh ~1 fps — tap to nudge/)).toBeTruthy();
    // The hard STOP stays available while degraded.
    expect(screen.getByRole('button', { name: 'Stop camera movement' })).toBeTruthy();
  });

  it('phone layout keeps the always-present hard STOP and folds vision + capabilities into the "…" menu', async () => {
    mockApi();
    render(
      <CameraControls
        {...base}
        camera={camera({ ptz: true, audio: true })}
        formFactor="phone"
        padSize={88}
      />,
    );
    expect(screen.getByRole('button', { name: 'Stop camera movement' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More controls' }));
    expect(await screen.findByRole('menuitemradio', { name: /Auto/ })).toBeTruthy(); // vision folded in
    expect(screen.getByText('Listen')).toBeTruthy(); // capability folded in
  });

  it('drives status dots and icon strokes from theme tokens so Night-Red can remap them', () => {
    // Hardcoded hex here would survive the theme swap and leak blue/green light at night.
    mockApi();
    render(<CameraControls {...base} camera={camera()} live />);
    const chip = screen.getByRole('button', { name: 'Stream variant' });
    expect((chip.querySelector('.cchip__dot') as HTMLElement).style.background).toBe(
      'var(--status-online)',
    );
    const vision = screen.getByRole('button', { name: 'Vision mode' });
    expect(vision.querySelector('svg')?.getAttribute('style')).toContain('var(--cx-accent-ico)');
  });

  it('shows the idle stream dot from the status-dark token when not live', () => {
    mockApi();
    render(<CameraControls {...base} camera={camera()} live={false} />);
    const chip = screen.getByRole('button', { name: 'Stream variant' });
    expect((chip.querySelector('.cchip__dot') as HTMLElement).style.background).toBe(
      'var(--status-dark)',
    );
  });

  it('disables Record with the tier reason when the gate says recording is unavailable', async () => {
    const reason = 'Recording isn’t available on this hardware tier — live viewing still works.';
    const fetchMock = mockApi();
    render(<CameraControls {...base} camera={camera()} recordGate={{ allowed: false, reason }} />);
    const record = screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    expect(record.title).toBe(reason);
    fireEvent.click(record);
    await Promise.resolve();
    expect(
      fetchMock.mock.calls.some(([u, i]) => String(u).includes('/record') && i?.method === 'POST'),
    ).toBe(false);
  });

  it('keeps Record enabled when the gate allows (and when no gate arrived)', () => {
    mockApi();
    const { rerender } = render(
      <CameraControls {...base} camera={camera()} recordGate={{ allowed: true, reason: '' }} />,
    );
    let record = screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement;
    expect(record.disabled).toBe(false);
    expect(record.title).toBe('');
    rerender(<CameraControls {...base} camera={camera()} />);
    record = screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement;
    expect(record.disabled).toBe(false);
  });

  it('offers a manual transport pin in the stream menu (Auto = server walk)', async () => {
    const onForceTransport = vi.fn();
    mockApi();
    render(<CameraControls {...base} camera={camera()} onForceTransport={onForceTransport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stream variant' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Transport · WebRTC/ }));
    expect(onForceTransport).toHaveBeenCalledWith('webrtc');
  });
});
