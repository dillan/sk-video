import { Cam } from 'onvif';
import type { IOnvifCam, OnvifConnect } from './onvif-controller';

export interface IOnvifTarget {
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
  timeoutMs?: number;
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
        const cam = new Cam(
          {
            hostname: target.hostname,
            port: target.port ?? 80,
            username: target.username,
            password: target.password,
            timeout: target.timeoutMs ?? 5000
          },
          (err) => (err ? reject(err) : resolve(cam as unknown as IOnvifCam))
        );
      }).catch((err) => {
        cached = null;
        throw err;
      });
    }
    return cached;
  };
}
