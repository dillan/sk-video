import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { CameraWizard } from './CameraWizard';

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
    expect(screen.getByText('absolute PTZ')).toBeTruthy();

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
    fireEvent.click(screen.getByRole('button', { name: 'Enter address manually' }));
    fireEvent.change(screen.getByPlaceholderText('192.168.1.100'), {
      target: { value: '192.168.1.100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & read' }));

    await waitFor(() => expect(screen.getByText('REOLINK RLC-823S2')).toBeTruthy());
    // The H.264 sub-stream is surfaced and the H.265 caveat is explained honestly.
    expect(screen.getByText('H.264 sub-stream')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Enter address manually' }));
    fireEvent.change(screen.getByPlaceholderText('192.168.1.100'), {
      target: { value: '192.168.1.100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & read' }));
    await waitFor(() =>
      expect(screen.getByText(/Couldn’t reach or read that camera/)).toBeTruthy(),
    );
  });
});
