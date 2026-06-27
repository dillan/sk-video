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

/** An absolute PTZ position in ONVIF normalized generic space. */
export interface IPtzPosition {
  /** Pan position, -1 (left) … 1 (right). */
  pan: number;
  /** Tilt position, -1 (down) … 1 (up). */
  tilt: number;
  /** Zoom position, 0 (wide) … 1 (tele). */
  zoom: number;
}

/**
 * Clamps an absolute PTZ position to the ONVIF normalized generic space: pan/tilt to [-1, 1] and
 * zoom to [0, 1] (absolute zoom is one-sided, unlike a zoom velocity). Missing or non-finite values
 * coerce to 0. NOTE: stubbed — behaviour is added in the GREEN step.
 */
export function clampPtzPosition(_input: Partial<IPtzPosition> | null | undefined): IPtzPosition {
  return { pan: 0, tilt: 0, zoom: 0 };
}

/**
 * Validates a preset/profile token before it is sent to the camera. Tokens are short, plain
 * identifiers; anything else is rejected to avoid SOAP/XML injection.
 */
export function isValidPtzToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(token);
}
