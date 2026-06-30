import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { IOperationalConfigPublic } from '../api';

const api = vi.hoisted(() => ({
  fetchOperationalConfig: vi.fn(),
  saveOperationalConfig: vi.fn(),
}));
vi.mock('../api', () => api);

import { OperationalSettings } from './OperationalSettings';

const CONFIG: IOperationalConfigPublic = {
  hardwareTier: 'pi4',
  anchorWatchPath: 'notifications.navigation.anchor',
  autoTriggerPath: '',
  mobVisualRefine: false,
  frigate: {
    mqttHost: '192.168.1.10',
    mqttPort: 1883,
    mqttUsername: 'frig',
    labels: 'person,car',
    mqttPasswordSet: true,
  },
};

beforeEach(() => {
  api.fetchOperationalConfig.mockResolvedValue(CONFIG);
  api.saveOperationalConfig.mockResolvedValue({ ok: true });
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
});
