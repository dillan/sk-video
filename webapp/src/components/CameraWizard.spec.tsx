import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { CameraWizard } from './CameraWizard';
import type { ICameraEntry } from '../api';

const ok = (json: unknown) => Promise.resolve({ ok: true, json: async () => json });

const INTROSPECT = {
  manufacturer: 'REOLINK',
  model: 'RLC-823S2',
  source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/Preview_01_main' },
  ptz: true,
  absolutePtz: true,
  imaging: true,
  imagingControls: ['irCut'],
  audio: true,
  audioBackchannel: true,
};

function mockApi(opts: { introspectOk?: boolean; introspect?: unknown } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/discover/introspect')) {
        return opts.introspectOk === false
          ? Promise.resolve({ ok: false, status: 502 })
          : ok(opts.introspect ?? INTROSPECT);
      }
      if (u.includes('/onboarding-hints')) {
        return ok({
          hints: [
            {
              key: 'insta360-x',
              make: 'Insta360',
              models: ['X3', 'X4', 'X5'],
              apHost: '192.168.42.1',
              steps: ['Power the camera and turn on its WiFi.', 'Join the server to it.'],
              sources: [
                {
                  label: 'WiFi 360 preview (RTSP)',
                  scheme: 'rtsp',
                  host: '192.168.42.1',
                  port: 8554,
                  path: '/live',
                  projection: 'equirectangular',
                },
              ],
              caveats: ['Reverse-engineered preview.'],
            },
            {
              key: 'gopro-hero',
              make: 'GoPro',
              models: ['HERO13 Black'],
              apHost: '10.5.5.9',
              steps: ['Install GoPro Labs.', 'Run an RTMP server.', 'Push rtmp:// to it.'],
              sources: [],
              caveats: ['Push-only; expect restarts.'],
            },
          ],
        });
      }
      if (u.includes('/cameras/test')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        // Mirror the server: with a make/model hint and a failing path, suggest known vendor paths.
        if (body.hint && !body.source?.path) {
          return ok({
            ok: false,
            message: 'Reached the camera, but no video stream answered at that path.',
            suggestedPaths: { main: '/h264Preview_01_main', sub: '/h264Preview_01_sub' },
          });
        }
        return ok({ ok: true, message: 'Stream reachable — video found.' });
      }
      if (u.includes('/cameras/discover')) {
        return ok({
          cameras: [
            { name: 'arlo', host: 'arlo', port: 5357, onvifUrl: 'http://Arlo:5357/guid' },
            {
              name: '192.168.1.100',
              host: '192.168.1.100',
              port: 8000,
              onvifUrl: 'http://192.168.1.100:8000/onvif/device_service',
            },
          ],
        });
      }
      // PUT resource + POST credentials both succeed
      return ok({});
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CameraWizard', () => {
  it('walks scan → pick → introspect → save, ranking the ONVIF camera first', async () => {
    const calls = mockApi();
    const onDone = vi.fn();
    render(<CameraWizard onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: 'Scan the network' }));
    // The real ONVIF camera is badged a camera; the NAS/WSD hit is "other device".
    await waitFor(() => expect(screen.getByText('ONVIF camera')).toBeTruthy());
    expect(screen.getByText('other device')).toBeTruthy();
    // Ranking: the first candidate button is the ONVIF camera.
    const firstCandidate = screen.getAllByText(/192\.168\.1\.100|arlo/)[0];
    expect(firstCandidate.textContent).toContain('192.168.1.100');

    fireEvent.click(screen.getByText('192.168.1.100').closest('button')!);
    // Connect step: enter the camera login and read it.
    fireEvent.change(screen.getByPlaceholderText('the camera’s own login'), {
      target: { value: 'admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & read' }));

    await waitFor(() => expect(screen.getByText('REOLINK RLC-823S2')).toBeTruthy());
    expect(screen.getByText('PTZ')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save camera' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));

    // The save PUT carried only the allowed fields, with the resolved RTSP source.
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put).toBeTruthy();
    const body = JSON.parse(put!.init!.body as string);
    expect(body).toMatchObject({
      name: 'REOLINK RLC-823S2',
      enabled: true,
      source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/Preview_01_main' },
      capabilities: { absolutePtz: true },
    });
    expect(body.password).toBeUndefined(); // credentials never go in the resource
    // Credentials were stored via the dedicated write-only endpoint.
    expect(calls.some((c) => c.url.includes('/credentials') && c.init?.method === 'POST')).toBe(
      true,
    );
  });

  it('surfaces the H.264 sub-stream and writes media when the main is H.265', async () => {
    const calls = mockApi({
      introspect: {
        ...INTROSPECT,
        codec: 'h265',
        substreams: true,
        substreamPath: '/Preview_01_sub',
        streams: [
          {
            codec: 'h265',
            width: 3840,
            height: 2160,
            source: { scheme: 'rtsp', host: '192.168.1.100', path: '/Preview_01_main' },
          },
          {
            codec: 'h264',
            width: 640,
            height: 480,
            source: { scheme: 'rtsp', host: '192.168.1.100', path: '/Preview_01_sub' },
          },
        ],
      },
    });
    render(<CameraWizard onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter the camera’s address' }));
    fireEvent.change(screen.getByPlaceholderText('192.168.1.100'), {
      target: { value: '192.168.1.100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & read' }));

    await waitFor(() => expect(screen.getByText('REOLINK RLC-823S2')).toBeTruthy());
    // The H.264 sub-stream is surfaced and the H.265 caveat is explained honestly.
    expect(screen.getByText('H.264 sub')).toBeTruthy();
    expect(screen.getByText(/the live view will use the camera’s H.264 sub-stream/)).toBeTruthy();
    // Both detected profiles are listed with their resolution.
    expect(screen.getByText(/3840×2160/)).toBeTruthy();
    expect(screen.getByText(/640×480/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save camera' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    const body = JSON.parse(put.init!.body as string);
    expect(body.media).toEqual({ codec: 'h265', substreamPath: '/Preview_01_sub' });
    expect(body.capabilities.substreams).toBe(true);
  });

  it('is honest when the camera can’t be read (bad login / unreachable)', async () => {
    mockApi({ introspectOk: false });
    render(<CameraWizard onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter the camera’s address' }));
    fireEvent.change(screen.getByPlaceholderText('192.168.1.100'), {
      target: { value: '192.168.1.100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & read' }));
    await waitFor(() =>
      expect(screen.getByText(/Couldn’t reach or read that camera/)).toBeTruthy(),
    );
  });
});

// The stored camera an edit opens on — includes a calibration the web app doesn't model, which a
// save must carry through untouched.
const ENTRY = {
  id: 'bow',
  name: 'Bow',
  enabled: true,
  role: 'security',
  source: { scheme: 'rtsp', host: '192.168.1.100', port: 554, path: '/main' },
  placement: { mount: 'bow', bearingRelativeDeg: 0 },
  capabilities: { ptz: true, absolutePtz: true },
  calibration: { pan: { offset: 0.1 } },
} as unknown as ICameraEntry;

describe('CameraWizard edit mode', () => {
  it('opens pre-filled on the details step, skipping discovery, with the id locked', () => {
    mockApi();
    render(<CameraWizard edit={ENTRY} onDone={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Edit Bow' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan the network' })).toBeNull();
    // Pre-filled from the stored entry: name, source, placement, role, enabled.
    expect(screen.getByDisplayValue('Bow')).toBeTruthy();
    expect(screen.getByDisplayValue('192.168.1.100')).toBeTruthy();
    expect(screen.getByDisplayValue('/main')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement).checked).toBe(
      true,
    );
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects.map((s) => s.value)).toEqual(['security', 'bow']);
    // The id is the resource key — locked so an edit can never mint a new camera.
    // ('bow' also reads as the mount select's displayed option, so narrow to the input.)
    const id = screen
      .getAllByDisplayValue('bow')
      .find((el) => el.tagName === 'INPUT') as HTMLInputElement;
    expect(id.disabled).toBe(true);
  });

  it('saves by PUTting the SAME id, preserving fields the form does not edit', async () => {
    const calls = mockApi();
    const onDone = vi.fn();
    render(<CameraWizard edit={ENTRY} onDone={onDone} />);
    fireEvent.change(screen.getByDisplayValue('Bow'), { target: { value: 'Bow PTZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));

    const puts = calls.filter((c) => c.init?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toContain('/resources/cameras/bow');
    const body = JSON.parse(puts[0].init!.body as string);
    expect(body.name).toBe('Bow PTZ');
    expect(body.enabled).toBe(true);
    // Untouched stored fields survive the edit (incl. the unmodeled calibration).
    expect(body.capabilities).toEqual({ ptz: true, absolutePtz: true });
    expect(body.calibration).toEqual({ pan: { offset: 0.1 } });
    expect(body.id).toBeUndefined();
  });

  it('never echoes a stored login — presence only — and skips the credentials write untouched', async () => {
    const calls = mockApi();
    const onDone = vi.fn();
    render(<CameraWizard edit={ENTRY} hasStoredLogin onDone={onDone} />);
    // Presence is stated; the login fields are empty (the stored secret is never fetched or shown).
    expect(screen.getByText(/Login stored — write-only, never shown here/)).toBeTruthy();
    const user = screen.getByPlaceholderText('leave blank to keep the current login');
    expect((user as HTMLInputElement).value).toBe('');
    expect(calls.some((c) => c.url.includes('/credentials'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    // No new login typed → no credentials POST; the resource body carries no secret either.
    expect(calls.some((c) => c.url.includes('/credentials'))).toBe(false);
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(JSON.parse(put.init!.body as string).password).toBeUndefined();
  });

  it('stores a NEW login via the write-only endpoint when one is entered', async () => {
    const calls = mockApi();
    const onDone = vi.fn();
    render(<CameraWizard edit={ENTRY} hasStoredLogin onDone={onDone} />);
    fireEvent.change(screen.getByPlaceholderText('leave blank to keep the current login'), {
      target: { value: 'admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    const cred = calls.find((c) => c.url.includes('/credentials') && c.init?.method === 'POST');
    expect(cred).toBeTruthy();
    expect(cred!.url).toContain('/cameras/bow/credentials');
    expect(JSON.parse(cred!.init!.body as string).username).toBe('admin');
  });

  it('walks a GoPro through the push-model setup: no ONVIF probe, honest steps, tested rtmp source', async () => {
    const calls = mockApi();
    render(<CameraWizard onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Action camera (GoPro / Insta360)' }));
    fireEvent.click(await screen.findByRole('button', { name: /GoPro/ }));

    // The walkthrough teaches the push model — a GoPro has nothing to pull directly.
    expect(screen.getByText(/Run an RTMP server/)).toBeTruthy();
    expect(screen.getByText(/Push-only; expect restarts/)).toBeTruthy();

    // No pull source exists, so Continue stays disabled until an address is entered.
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByPlaceholderText(/RTMP server/), {
      target: { value: '192.168.1.10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test the stream' }));
    await waitFor(() => expect(screen.getByText(/Stream reachable/)).toBeTruthy());
    const probe = calls.find((c) => c.url.includes('/cameras/test'));
    expect(JSON.parse(String(probe!.init?.body))).toMatchObject({
      source: { scheme: 'rtmp', host: '192.168.1.10' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save camera' }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.includes('/resources/cameras/') && c.init?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put!.init?.body));
      expect(body.source).toMatchObject({ scheme: 'rtmp', host: '192.168.1.10' });
      expect(body.device).toMatchObject({ manufacturer: 'GoPro' });
      // Action cams advertise no ONVIF — capabilities are honestly all-false, never guessed.
      expect(body.capabilities.ptz).toBe(false);
    });
    // The ONVIF introspection path is never touched on this route.
    expect(calls.some((c) => c.url.includes('/discover/introspect'))).toBe(false);
  });

  it('pre-fills the Insta360 RTSP preview and persists the 360 projection', async () => {
    const calls = mockApi();
    render(<CameraWizard onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Action camera (GoPro / Insta360)' }));
    fireEvent.click(await screen.findByRole('button', { name: /Insta360/ }));

    // The known AP source is pre-filled — nothing to type for the happy path.
    expect((screen.getByPlaceholderText('192.168.42.1') as HTMLInputElement).value).toBe(
      '192.168.42.1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save camera' }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.includes('/resources/cameras/') && c.init?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put!.init?.body));
      expect(body.source).toMatchObject({
        scheme: 'rtsp',
        host: '192.168.42.1',
        port: 8554,
        path: '/live',
      });
      // The 360 geometry rides along so clients know to render a spherical view.
      expect(body.media).toMatchObject({ projection: 'equirectangular' });
    });
  });

  it('onboards a plain RTSP camera from a pasted URL: creds stripped write-only, tested, saved', async () => {
    const calls = mockApi();
    const onDone = vi.fn();
    render(<CameraWizard onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set it up manually' }));
    fireEvent.change(screen.getByPlaceholderText('rtsp://192.168.1.50:554/stream1'), {
      target: { value: 'rtsp://admin:pw@192.168.1.60:554/stream1' },
    });
    // The URL's embedded login moved into the write-only fields, with the honest note.
    expect(screen.getByText(/stored\s+write-only, never in the shared camera record/)).toBeTruthy();
    expect(
      (screen.getByPlaceholderText('only if the stream needs one') as HTMLInputElement).value,
    ).toBe('admin');
    // Structured fields were parsed out of the URL.
    expect((screen.getByPlaceholderText('192.168.1.50') as HTMLInputElement).value).toBe(
      '192.168.1.60',
    );
    expect((screen.getByPlaceholderText('/stream1') as HTMLInputElement).value).toBe('/stream1');

    fireEvent.click(screen.getByRole('button', { name: 'Test the stream' }));
    await waitFor(() => expect(screen.getByText(/Stream reachable/)).toBeTruthy());
    const probe = calls.find((c) => c.url.includes('/cameras/test'));
    const probeBody = JSON.parse(String(probe!.init?.body));
    expect(probeBody.source).toMatchObject({ scheme: 'rtsp', host: '192.168.1.60', port: 554 });
    expect(probeBody.username).toBe('admin'); // creds ride the one-shot probe…

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save camera' }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.includes('/resources/cameras/') && c.init?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put!.init?.body));
      // …but the resource itself never carries them.
      expect(JSON.stringify(body)).not.toContain('admin');
      expect(JSON.stringify(body)).not.toContain('pw');
      expect(body.source).toEqual({
        scheme: 'rtsp',
        host: '192.168.1.60',
        port: 554,
        path: '/stream1',
      });
      expect(body.capabilities.ptz).toBe(false); // nothing introspected — never guessed
      const creds = calls.find((c) => c.url.includes('/credentials') && c.init?.method === 'POST');
      expect(creds).toBeTruthy();
    });
    expect(onDone).toHaveBeenCalledWith(true);
    // The ONVIF introspection path is never touched on this route.
    expect(calls.some((c) => c.url.includes('/discover/introspect'))).toBe(false);
  });

  it('onboards a manual camera with a declared compass sensor and a fixed geolocation', async () => {
    const calls = mockApi();
    const onDone = vi.fn();
    render(<CameraWizard onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set it up manually' }));
    // Fill the address by hand (no URL paste), then move to details.
    fireEvent.change(screen.getByPlaceholderText('192.168.1.50'), {
      target: { value: '10.0.0.9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Declare the compass sensor and a fixed shore location.
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /reports its own compass bearing/ }),
    );
    fireEvent.change(screen.getByPlaceholderText('e.g. 37.8199'), { target: { value: '37.82' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. -122.4783'), {
      target: { value: '-122.48' },
    });
    fireEvent.change(screen.getByPlaceholderText('0 = north'), { target: { value: '270' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save camera' }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.includes('/resources/cameras/') && c.init?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put!.init?.body));
      expect(body.capabilities.sensors).toEqual(['bearing']);
      expect(body.geolocation).toEqual({
        latitude: 37.82,
        longitude: -122.48,
        orientationDeg: 270,
      });
    });
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it('refuses to save a half-entered fixed location (a fix needs both coordinates)', async () => {
    const calls = mockApi();
    render(<CameraWizard onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set it up manually' }));
    fireEvent.change(screen.getByPlaceholderText('192.168.1.50'), {
      target: { value: '10.0.0.9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Latitude only — no longitude.
    fireEvent.change(await screen.findByPlaceholderText('e.g. 37.8199'), {
      target: { value: '37.82' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save camera' }));
    await waitFor(() => expect(screen.getByText(/both latitude and longitude/i)).toBeTruthy());
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false); // nothing was saved
  });

  it('onboards a plain RTMP camera: scheme-aware placeholders and a saved rtmp source', async () => {
    const calls = mockApi();
    render(<CameraWizard onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set it up manually' }));
    // Paste an RTMP URL — the structured fields parse out of it.
    fireEvent.change(screen.getByPlaceholderText('rtsp://192.168.1.50:554/stream1'), {
      target: { value: 'rtmp://10.0.0.9:1935/live/boat' },
    });
    // The port/path placeholders now follow the RTMP scheme, not RTSP.
    expect(screen.getByPlaceholderText('1935')).toBeTruthy();
    expect((screen.getByPlaceholderText('/live/streamKey') as HTMLInputElement).value).toBe(
      '/live/boat',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test the stream' }));
    await waitFor(() => expect(screen.getByText(/Stream reachable/)).toBeTruthy());
    const probe = calls.find((c) => c.url.includes('/cameras/test'));
    expect(JSON.parse(String(probe!.init?.body)).source).toMatchObject({
      scheme: 'rtmp',
      host: '10.0.0.9',
      port: 1935,
      path: '/live/boat',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save camera' }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.includes('/resources/cameras/') && c.init?.method === 'PUT',
      );
      expect(JSON.parse(String(put!.init?.body)).source).toEqual({
        scheme: 'rtmp',
        host: '10.0.0.9',
        port: 1935,
        path: '/live/boat',
      });
    });
  });

  it('suggests known vendor paths from the make/model hint and applies them (incl. the substream)', async () => {
    const calls = mockApi();
    render(<CameraWizard onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set it up manually' }));
    fireEvent.change(screen.getByPlaceholderText('192.168.1.50'), {
      target: { value: '192.168.1.61' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Hikvision, Reolink, Dahua/), {
      target: { value: 'Reolink' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test the stream' }));
    await waitFor(() => expect(screen.getByText(/no video stream answered/)).toBeTruthy());
    const probe = calls.find((c) => c.url.includes('/cameras/test'));
    expect(JSON.parse(String(probe!.init?.body)).hint).toBe('Reolink');

    fireEvent.click(screen.getByRole('button', { name: 'use /h264Preview_01_main' }));
    expect((screen.getByPlaceholderText('/stream1') as HTMLInputElement).value).toBe(
      '/h264Preview_01_main',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save camera' }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.includes('/resources/cameras/') && c.init?.method === 'PUT',
      );
      const body = JSON.parse(String(put!.init?.body));
      expect(body.source.path).toBe('/h264Preview_01_main');
      // The vendor's known sub-stream rides along, like introspection would record it.
      expect(body.media).toMatchObject({ substreamPath: '/h264Preview_01_sub' });
      expect(body.capabilities.substreams).toBe(true);
    });
  });

  it('offers the plain-stream escape when ONVIF introspection fails, carrying the host over', async () => {
    mockApi({ introspectOk: false });
    render(<CameraWizard onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter the camera’s address' }));
    fireEvent.change(screen.getByPlaceholderText('192.168.1.100'), {
      target: { value: '192.168.1.62' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & read' }));
    await waitFor(() => expect(screen.getByText(/add it as a plain stream below/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'No ONVIF? Add as a plain stream' }));
    // The address carries over — the user doesn't retype what they already entered.
    expect((screen.getByPlaceholderText('192.168.1.50') as HTMLInputElement).value).toBe(
      '192.168.1.62',
    );
  });
});
