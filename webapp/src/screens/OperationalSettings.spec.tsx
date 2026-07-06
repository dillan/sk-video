import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { IOperationalConfigPublic } from '../api';

const api = vi.hoisted(() => ({
  fetchOperationalConfig: vi.fn(),
  saveOperationalConfig: vi.fn(),
  fetchCameras: vi.fn(),
  fetchStatus: vi.fn(),
}));
vi.mock('../api', () => api);

import { OperationalSettings } from './OperationalSettings';

const CONFIG: IOperationalConfigPublic = {
  hardwareTier: 'pi4',
  anchorWatchPath: 'notifications.navigation.anchor',
  autoTriggerPath: '',
  mobVisualRefine: false,
  cameraHealthZones: {
    bow: { warnAfterSeconds: 45, alarmAfterSeconds: 120 },
  },
  frigate: {
    mqttHost: '192.168.1.10',
    mqttPort: 1883,
    mqttUsername: 'frig',
    labels: 'person,car',
    mqttPasswordSet: true,
  },
};

const CAMERAS = [
  { id: 'bow', name: 'Bow Camera', enabled: true },
  { id: 'stern', name: 'Stern Camera', enabled: true },
  { id: 'engine', name: 'Engine Bay', enabled: false }, // disabled cameras get no zone row
];

beforeEach(() => {
  api.fetchOperationalConfig.mockResolvedValue(CONFIG);
  api.saveOperationalConfig.mockResolvedValue({ ok: true });
  api.fetchCameras.mockResolvedValue(CAMERAS);
  api.fetchStatus.mockResolvedValue({ ready: true, ffmpegHwaccel: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OperationalSettings', () => {
  it('loads and populates the form, and marks the password as already set', async () => {
    render(<OperationalSettings />);
    const host = (await waitFor(() =>
      screen.getByDisplayValue('192.168.1.10'),
    )) as HTMLInputElement;
    expect(host).toBeTruthy();
    // password input is empty but its placeholder signals a stored value
    const pw = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pw.value).toBe('');
    expect(pw.placeholder).toMatch(/unchanged/);
  });

  it('omits the password on save when left blank (keeps the stored one) and warns about the restart', async () => {
    render(<OperationalSettings />);
    await waitFor(() => screen.getByDisplayValue('192.168.1.10'));
    fireEvent.click(screen.getByRole('button', { name: 'Save & apply' }));
    await waitFor(() => expect(api.saveOperationalConfig).toHaveBeenCalled());
    const payload = api.saveOperationalConfig.mock.calls[0][0] as {
      frigate: Record<string, unknown>;
    };
    expect('mqttPassword' in payload.frigate).toBe(false); // omitted → server keeps the stored one
    await waitFor(() => expect(screen.getByText(/restarting/)).toBeTruthy());
  });

  it('sends hardwareAcceleration on save when the operator turns it on', async () => {
    render(<OperationalSettings />);
    await waitFor(() => screen.getByDisplayValue('192.168.1.10'));
    fireEvent.click(screen.getByLabelText(/Hardware video acceleration/));
    fireEvent.click(screen.getByRole('button', { name: 'Save & apply' }));
    await waitFor(() => expect(api.saveOperationalConfig).toHaveBeenCalled());
    const payload = api.saveOperationalConfig.mock.calls[0][0] as { hardwareAcceleration: boolean };
    expect(payload.hardwareAcceleration).toBe(true);
  });

  it('warns honestly when acceleration is on but no hardware encoder was detected', async () => {
    api.fetchStatus.mockResolvedValue({
      ready: true,
      hardwareAcceleration: true,
      ffmpegHwaccel: { ffmpegPresent: true, methods: [], h264Encoders: [], hardwareEncode: false },
    });
    api.fetchOperationalConfig.mockResolvedValue({ ...CONFIG, hardwareAcceleration: true });
    render(<OperationalSettings />);
    await waitFor(() => screen.getByText(/No hardware H.264 encoder detected/));
  });

  it('includes the password only when the operator types one', async () => {
    render(<OperationalSettings />);
    await waitFor(() => screen.getByDisplayValue('192.168.1.10'));
    const pw = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: 'newsecret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & apply' }));
    await waitFor(() => expect(api.saveOperationalConfig).toHaveBeenCalled());
    const payload = api.saveOperationalConfig.mock.calls[0][0] as {
      frigate: Record<string, unknown>;
    };
    expect(payload.frigate.mqttPassword).toBe('newsecret');
  });

  it('lists a health-alarm row per enabled camera, pre-filled from the stored zones', async () => {
    render(<OperationalSettings />);
    await waitFor(() => screen.getByText('Bow Camera'));
    expect(screen.getByText('Stern Camera')).toBeTruthy();
    expect(screen.queryByText('Engine Bay')).toBeNull(); // disabled camera → no row
    const bowToggle = screen.getByRole('checkbox', {
      name: /Bow Camera/,
    }) as HTMLInputElement;
    expect(bowToggle.checked).toBe(true); // stored zone entry → enabled
    const sternToggle = screen.getByRole('checkbox', { name: /Stern Camera/ }) as HTMLInputElement;
    expect(sternToggle.checked).toBe(false);
    expect((screen.getByLabelText(/Bow Camera.*warn/i) as HTMLInputElement).value).toBe('45');
    expect((screen.getByLabelText(/Bow Camera.*alarm/i) as HTMLInputElement).value).toBe('120');
  });

  it('sends cameraHealthZones for exactly the toggled cameras on save', async () => {
    render(<OperationalSettings />);
    await waitFor(() => screen.getByText('Stern Camera'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Stern Camera/ }));
    fireEvent.change(screen.getByLabelText(/Stern Camera.*warn/i), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(/Stern Camera.*alarm/i), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Bow Camera/ })); // hand bow back to the plugin
    fireEvent.click(screen.getByRole('button', { name: 'Save & apply' }));
    await waitFor(() => expect(api.saveOperationalConfig).toHaveBeenCalled());
    const payload = api.saveOperationalConfig.mock.calls[0][0] as {
      cameraHealthZones: Record<string, unknown>;
    };
    expect(payload.cameraHealthZones).toEqual({
      stern: { warnAfterSeconds: 60, alarmAfterSeconds: 300 },
    });
  });
});
