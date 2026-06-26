import type { ICamera } from '../cameras/camera-validation';

export interface ICameraCredentials {
  username?: string;
  password?: string;
}

/**
 * Builds the go2rtc source URL for a camera from its validated, structured fields, injecting
 * server-side credentials (URL-encoded). Because the scheme is restricted by camera validation to a
 * safe allow-list, this can never produce a dangerous go2rtc source such as `exec:` or `ffmpeg:`.
 */
export function buildGo2rtcSource(camera: ICamera, creds?: ICameraCredentials): string {
  void camera;
  void creds;
  // RED stub.
  return '';
}
