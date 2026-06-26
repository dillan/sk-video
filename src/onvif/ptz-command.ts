export interface IPtzVelocity {
  /** Pan velocity, -1 (left) … 1 (right). */
  pan: number;
  /** Tilt velocity, -1 (down) … 1 (up). */
  tilt: number;
  /** Zoom velocity, -1 (out) … 1 (in). */
  zoom: number;
}

/**
 * Clamps a PTZ velocity command to the ONVIF normalized range [-1, 1] per axis, coercing missing or
 * non-finite values to 0. This bounds what can be sent to a camera regardless of client input.
 */
const axis = (v: unknown): number => {
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, n));
};

export function clampPtzVelocity(input: Partial<IPtzVelocity> | null | undefined): IPtzVelocity {
  return { pan: axis(input?.pan), tilt: axis(input?.tilt), zoom: axis(input?.zoom) };
}

/**
 * Validates a preset/profile token before it is sent to the camera. Tokens are short, plain
 * identifiers; anything else is rejected to avoid SOAP/XML injection.
 */
export function isValidPtzToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(token);
}
