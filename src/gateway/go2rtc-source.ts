import type { ICamera } from '../cameras/camera-validation';

export interface ICameraCredentials {
  username?: string;
  password?: string;
}

/**
 * Builds the go2rtc source URL for a camera from its validated, structured fields, injecting
 * server-side credentials (URL-encoded). Because the scheme is restricted by camera validation to a
 * safe allow-list, this can never produce a dangerous go2rtc source such as `exec:` or `ffmpeg:`.
 * `pathOverride` swaps in an alternate (already-validated) path — used for the low-res substream — so
 * the credentials are injected the same way for every variant.
 */
export function buildGo2rtcSource(
  camera: ICamera,
  creds?: ICameraCredentials,
  pathOverride?: string,
): string {
  const { scheme, host, port } = camera.source;
  const path = pathOverride ?? camera.source.path;

  let userinfo = '';
  if (creds?.username) {
    const user = encodeURIComponent(creds.username);
    const pass = encodeURIComponent(creds.password ?? '');
    userinfo = `${user}:${pass}@`;
  }

  const portPart = port !== undefined ? `:${port}` : '';
  const pathPart = path ?? '';

  return `${scheme}://${userinfo}${host}${portPart}${pathPart}`;
}
