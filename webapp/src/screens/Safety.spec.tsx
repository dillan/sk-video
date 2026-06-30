import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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
});
