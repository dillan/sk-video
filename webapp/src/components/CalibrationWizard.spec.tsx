import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { CalibrationWizard } from './CalibrationWizard';

type Call = { url: string; init?: RequestInit };

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });
const bad = (status: number) => Promise.resolve({ ok: false, status, json: async () => ({}) });

/** Mock fetch; `calibrationStatus` lets a test force the save POST to fail (e.g. 400 distinct-angle). */
function mockApi(calibrationStatus = 200) {
  const calls: Call[] = [];
  let pan = -0.5;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes('/ptz/position')) {
        const p = pan;
        pan += 1; // a moving camera so the two samples differ
        return ok({ pan: p, tilt: p / 2, zoom: 0 });
      }
      if (u.includes('/calibration') && calibrationStatus !== 200) return bad(calibrationStatus);
      return ok({});
    }),
  );
  return calls;
}

const captureAll = async () => {
  const inputs = screen.getAllByPlaceholderText(/forward|level/);
  const bearings = ['-30', '30', '-10', '10'];
  const buttons = screen.getAllByRole('button', { name: /Capture point/ });
  for (let i = 0; i < 4; i++) {
    fireEvent.change(inputs[i], { target: { value: bearings[i] } });
    fireEvent.click(buttons[i]);
    await waitFor(() => expect(screen.getAllByText(/n=/).length).toBeGreaterThanOrEqual(i + 1));
  }
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CalibrationWizard', () => {
  it('captures two points per axis and saves the solved samples', async () => {
    const calls = mockApi();
    const onDone = vi.fn();
    render(<CalibrationWizard id="reolink" name="Foredeck" onDone={onDone} />);
    await captureAll();

    fireEvent.click(screen.getByRole('button', { name: 'Save calibration' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));

    const post = calls.find((c) => c.url.includes('/calibration') && c.init?.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse(post!.init!.body as string);
    expect(body.pan).toHaveLength(2);
    expect(body.tilt).toHaveLength(2);
    expect(body.pan[0]).toMatchObject({ deg: -30 });
    expect(typeof body.pan[0].normalized).toBe('number');
  });

  it('asks for a bearing before capturing', async () => {
    mockApi();
    render(<CalibrationWizard id="reolink" name="Foredeck" onDone={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Capture point/ })[0]);
    await waitFor(() => expect(screen.getByText(/Enter the bearing you aimed at/)).toBeTruthy());
  });

  it('explains the distinct-angle rule when the server rejects with 400', async () => {
    mockApi(400);
    render(<CalibrationWizard id="reolink" name="Foredeck" onDone={vi.fn()} />);
    await captureAll();
    fireEvent.click(screen.getByRole('button', { name: 'Save calibration' }));
    await waitFor(() =>
      expect(screen.getByText(/two points at clearly different angles/)).toBeTruthy(),
    );
  });

  it('nudges the camera then auto-stops, and STOP halts immediately', async () => {
    vi.useFakeTimers();
    const calls = mockApi();
    render(<CalibrationWizard id="reolink" name="Foredeck" onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pan left' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.includes('/ptz') && !c.url.includes('stop'))).toBe(true),
    );
    // auto-stop fires ~350 ms after the nudge resolves
    await vi.advanceTimersByTimeAsync(400);
    expect(calls.some((c) => c.url.includes('/ptz/stop'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.url.includes('/ptz/stop')).length).toBeGreaterThanOrEqual(2),
    );
  });

  it('backs out without saving', () => {
    mockApi();
    const onDone = vi.fn();
    render(<CalibrationWizard id="reolink" name="Foredeck" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /‹ Cameras/ }));
    expect(onDone).toHaveBeenCalledWith(false);
  });
});
