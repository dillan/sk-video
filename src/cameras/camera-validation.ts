/**
 * The only stream schemes a camera definition may use. This allow-list is a security control: it
 * keeps dangerous go2rtc source schemes (exec:, ffmpeg:, pipe:, …) out of the system, so a camera
 * definition can never be turned into a shell command.
 */
export const CAMERA_SCHEMES = ['rtsp', 'rtsps', 'rtmp', 'http', 'https', 'onvif'] as const;
export type TCameraScheme = (typeof CAMERA_SCHEMES)[number];

export interface ICameraSource {
  scheme: TCameraScheme;
  host: string;
  port?: number;
  path?: string;
}

/** A camera definition as stored/served via the Signal K `cameras` resource (no credentials). */
export interface ICamera {
  name: string;
  enabled: boolean;
  source: ICameraSource;
}

export interface IValidationResult {
  valid: boolean;
  errors: string[];
  /** The normalised camera, present only when valid. */
  value?: ICamera;
}

/**
 * Validates and normalises an untrusted camera definition. Returns the cleaned record when valid, or
 * a list of errors. Credentials are never part of a camera resource and are rejected here.
 */
export function validateCamera(input: unknown): IValidationResult {
  void input;
  // RED stub.
  return { valid: false, errors: ['not implemented'] };
}
