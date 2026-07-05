import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// Control the read-only write gate; default is "not gated" so the existing tests are unaffected.
const gate = vi.hoisted(() => ({
  current: { disabled: false } as { disabled: boolean; title?: string },
}));
vi.mock('../lib/auth', () => ({ useWriteGate: () => gate.current }));

import { Safety } from './Safety';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

function mockApi(opts: {
  status?: unknown;
  armResult?: unknown;
  cameras?: Record<string, unknown>;
  armOk?: boolean;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/mob')) {
        if (init?.method === 'POST') {
          return opts.armOk === false
            ? Promise.resolve({ ok: false, status: 401 })
            : ok(opts.armResult ?? { active: true, targetSource: 'datum', aimedCameras: 0 });
        }
        return ok(opts.status ?? { active: false, targetSource: 'none', aimedCameras: 0 });
      }
      if (u.includes('/resources/cameras')) return ok(opts.cameras ?? {});
      return ok({});
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers(); // a failed fake-timer test must not starve the rest of the file
  gate.current = { disabled: false };
});

describe('Safety / MOB console', () => {
  it('shows the disarmed arm screen with the honesty banner', async () => {
    mockApi({ status: { active: false, targetSource: 'none', aimedCameras: 0 } });
    render(<Safety />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Arm man overboard' })).toBeTruthy(),
    );
    expect(screen.getByText(/not visual person-tracking/)).toBeTruthy();
  });

  it('disables the safety write controls with a reason for a read-only session', async () => {
    gate.current = { disabled: true, title: 'Safety controls need write access — ask an admin.' };
    mockApi({ status: { active: false, targetSource: 'none', aimedCameras: 0 } });
    render(<Safety />);
    const arm = (await screen.findByRole('button', {
      name: 'Arm man overboard',
    })) as HTMLButtonElement;
    expect(arm.disabled).toBe(true);
    expect(arm.getAttribute('title')).toMatch(/write access/);
  });

  it('arms on tap and reflects the active console + notifies the shell', async () => {
    const onMobChange = vi.fn();
    mockApi({
      status: { active: false, targetSource: 'none', aimedCameras: 0 },
      armResult: { active: true, targetSource: 'datum', aimedCameras: 2 },
      cameras: {
        bow: { name: 'Bow', enabled: true, capabilities: { absolutePtz: true } },
        mast: { name: 'Mast', enabled: true, capabilities: { absolutePtz: true } },
      },
    });
    render(<Safety onMobChange={onMobChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Arm man overboard' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Man overboard' })).toBeTruthy(),
    );
    expect(screen.getByText(/dead-reckoned datum/)).toBeTruthy();
    expect(screen.getByText(/of 2 cameras aimed/)).toBeTruthy();
    expect(onMobChange).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it('is honest that it cannot aim with no fix or beacon', async () => {
    mockApi({ status: { active: true, targetSource: 'none', aimedCameras: 0 } });
    render(<Safety />);
    await waitFor(() => expect(screen.getByText(/No target — no GPS fix or beacon/)).toBeTruthy());
  });

  it('marks an incident and slews capable cameras from the armed console', async () => {
    mockApi({
      status: { active: true, targetSource: 'datum', aimedCameras: 1 },
      cameras: { bow: { name: 'Bow', enabled: true, capabilities: { absolutePtz: true } } },
    });
    render(<Safety />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark incident' }));
    await waitFor(() => expect(screen.getByText(/Incident marked/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Slew all to AIS cue' }));
    await waitFor(() => expect(screen.getByText(/Slewed 1 of 1 cameras/)).toBeTruthy());
  });

  it('asks the operator to sign in when arming is rejected with 401', async () => {
    mockApi({ status: { active: false, targetSource: 'none', aimedCameras: 0 }, armOk: false });
    render(<Safety />);
    fireEvent.click(await screen.findByRole('button', { name: 'Arm man overboard' }));
    await waitFor(() => expect(screen.getByText(/Sign in to Signal K/)).toBeTruthy());
  });

  it('flags a failed, saturated, or unsolvable aim per camera — never a silent pending', async () => {
    mockApi({
      status: {
        active: true,
        targetSource: 'datum',
        aimedCameras: 1,
        capableCameras: 4,
        aimedCameraIds: ['bow'],
        cameraAims: [
          { id: 'bow', outcome: 'aimed' },
          { id: 'stern', outcome: 'at-limit' },
          { id: 'mast', outcome: 'no-solution' },
          { id: 'port', outcome: 'command-failed' },
        ],
        armedAt: 1,
        lastReaimAt: 2,
      },
      cameras: {
        bow: { name: 'Bow', enabled: true, capabilities: { absolutePtz: true } },
        stern: { name: 'Stern', enabled: true, capabilities: { absolutePtz: true } },
        mast: { name: 'Mast', enabled: true, capabilities: { absolutePtz: true } },
        port: { name: 'Port', enabled: true, capabilities: { absolutePtz: true } },
      },
    });
    render(<Safety />);
    await waitFor(() => expect(screen.getByText('✓ aimed')).toBeTruthy());
    expect(screen.getByText(/at pan limit — not on target/)).toBeTruthy();
    expect(screen.getByText(/no aim solution/)).toBeTruthy();
    expect(screen.getByText(/aim command failed/)).toBeTruthy();
  });

  it('badges the visual-refine assist NOT safety-rated, and only when enabled', async () => {
    mockApi({
      status: {
        active: true,
        targetSource: 'datum',
        aimedCameras: 0,
        capableCameras: 0,
        aimedCameraIds: [],
        cameraAims: [],
        armedAt: 1,
        lastReaimAt: 2,
        visualRefine: { enabled: true, active: true },
      },
    });
    render(<Safety />);
    await waitFor(() =>
      expect(screen.getByText(/Visual refine active · NOT safety-rated/)).toBeTruthy(),
    );
  });

  it('never shows a refine badge when the assist is not enabled', async () => {
    mockApi({
      status: {
        active: true,
        targetSource: 'datum',
        aimedCameras: 0,
        capableCameras: 0,
        aimedCameraIds: [],
        armedAt: 1,
        lastReaimAt: 2,
        visualRefine: { enabled: false, active: false },
      },
    });
    render(<Safety />);
    await waitFor(() => expect(screen.getByText(/Man overboard/)).toBeTruthy());
    expect(screen.queryByText(/Visual refine/)).toBeNull();
  });

  it('disarms via a held Enter/Space — the hold gesture has a keyboard equivalent', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/mob') && init?.method === 'POST') {
        return ok({ active: false, targetSource: 'none', aimedCameras: 0 });
      }
      if (u.endsWith('/mob')) {
        return ok({
          active: true,
          targetSource: 'datum',
          aimedCameras: 0,
          capableCameras: 0,
          aimedCameraIds: [],
          armedAt: 1,
          lastReaimAt: 2,
        });
      }
      return ok({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const { act } = await import('@testing-library/react');
    render(<Safety />);
    await act(async () => {
      await Promise.resolve();
    });
    const hold = screen.getByRole('button', { name: 'Hold to disarm' });
    fireEvent.keyDown(hold, { key: ' ' });
    await act(async () => {
      vi.advanceTimersByTime(900); // past the hold threshold
      await Promise.resolve();
    });
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => String(u).endsWith('/mob') && (i as RequestInit)?.method === 'POST',
      ),
    ).toBe(true);
    vi.useRealTimers();
  });
});
