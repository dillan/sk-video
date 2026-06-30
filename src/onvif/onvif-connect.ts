import { Cam } from 'onvif';
import type { IOnvifCam, OnvifConnect } from './onvif-controller';

export interface IOnvifTarget {
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
  timeoutMs?: number;
  /** Connect to the ONVIF service over HTTPS (TLS). Implied when allowSelfSigned is set. */
  useSecure?: boolean;
  /** Trust a self-signed certificate on an ONVIF-over-HTTPS connection to this camera. */
  allowSelfSigned?: boolean;
}

/**
 * Common ONVIF service ports, tried in order when a camera has no explicit ONVIF port. 80 is the
 * spec default (Hikvision/Dahua/Axis/Amcrest), 8000 is Reolink's, 8899 and 2020 cover other vendors.
 * This matters because a camera onboarded by its RTSP URL only records the RTSP port (554) — its ONVIF
 * port (a different service) is lost, so without probing we'd hit the camera's web server on :80 and
 * get "Wrong ONVIF SOAP response".
 */
export const DEFAULT_ONVIF_PORTS = [80, 8000, 8899, 2020] as const;

/** Open one ONVIF connection to a specific host:port; rejects on a connect or SOAP-handshake failure. */
export function openOnvifCam(target: IOnvifTarget): Promise<IOnvifCam> {
  return new Promise<IOnvifCam>((resolve, reject) => {
    // Self-signed trust only makes sense over TLS, so it implies useSecure — and without useSecure the
    // onvif client speaks plain HTTP, so an HTTPS-only camera (and the secureOpts below) were dead.
    const useSecure = target.useSecure === true || target.allowSelfSigned === true;
    const cam = new Cam(
      {
        hostname: target.hostname,
        port: target.port ?? 80,
        username: target.username,
        password: target.password,
        timeout: target.timeoutMs ?? 5000,
        ...(useSecure ? { useSecure: true } : {}),
        // Accept a self-signed cert only when the operator opted in for this camera (https ONVIF).
        ...(target.allowSelfSigned ? { secureOpts: { rejectUnauthorized: false } } : {}),
      },
      (err) => (err ? reject(err) : resolve(cam as unknown as IOnvifCam)),
    );
  });
}

/**
 * Connect to a camera's ONVIF service, probing the common ports when none is configured. Tries each in
 * order and returns the first that completes the ONVIF handshake; if all fail, throws the LAST error
 * (the most informative — a refused port fails immediately, a wrong-service port fails with a SOAP
 * error). `open` is injectable so the probe loop is unit-tested without a real camera.
 */
export async function connectWithPortProbe(
  target: IOnvifTarget,
  open: (t: IOnvifTarget) => Promise<IOnvifCam> = openOnvifCam,
): Promise<IOnvifCam> {
  const ports = target.port ? [target.port] : [...DEFAULT_ONVIF_PORTS];
  let lastErr: unknown;
  for (const port of ports) {
    try {
      return await open({ ...target, port });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('ONVIF connection failed');
}

/**
 * Returns a connect function that lazily opens (and then caches) an ONVIF connection to a camera,
 * probing the common ports when none is configured. A failed connection is not cached, so the next
 * call retries (and re-probes).
 */
export function createOnvifConnect(target: IOnvifTarget): OnvifConnect {
  let cached: Promise<IOnvifCam> | null = null;
  return () => {
    if (!cached) {
      cached = connectWithPortProbe(target).catch((err) => {
        cached = null;
        throw err;
      });
    }
    return cached;
  };
}
