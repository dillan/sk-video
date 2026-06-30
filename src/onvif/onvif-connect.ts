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
 * Returns a connect function that lazily opens (and then caches) an ONVIF connection to a camera. A
 * failed connection is not cached, so the next call retries.
 */
export function createOnvifConnect(target: IOnvifTarget): OnvifConnect {
  let cached: Promise<IOnvifCam> | null = null;
  return () => {
    if (!cached) {
      cached = new Promise<IOnvifCam>((resolve, reject) => {
        // Self-signed trust only makes sense over TLS, so it implies useSecure — and without useSecure
        // the onvif client speaks plain HTTP, so an HTTPS-only camera (and the secureOpts below) were
        // previously dead. Enable TLS when requested or implied.
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
      }).catch((err) => {
        cached = null;
        throw err;
      });
    }
    return cached;
  };
}
