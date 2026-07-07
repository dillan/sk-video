/**
 * PTZ interaction preference: discrete nudge taps are the DEFAULT (a one-shot move can't run away
 * from you); continuous press-and-hold pan — the pad drag and the full-frame drag gestures — is
 * opt-in per device, per the design ("PTZ defaults to discrete nudge taps with an always-present
 * hard STOP; press-and-hold is opt-in"). Storage access is defensive like the theme/density prefs.
 */

const STORAGE_KEY = 'sk-video.ptz-continuous';
const TAP_AIM_KEY = 'sk-video.ptz-tap-to-aim';

/** Whether continuous press-and-hold PTZ is enabled on this device (default: off). */
export function loadContinuousPtz(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveContinuousPtz(
  on: boolean,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, on ? 'true' : 'false');
  } catch {
    /* persistence is best-effort */
  }
}

/**
 * Whether single-tap-to-aim is enabled on this device. Default: ON — unlike continuous pan, a tap is a
 * discrete, recoverable move (it nudges the tapped point toward centre, bounded), so it's safe to have
 * on by default and matches the click-to-centre convention operators expect.
 */
export function loadTapToAim(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(TAP_AIM_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveTapToAim(on: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(TAP_AIM_KEY, on ? 'true' : 'false');
  } catch {
    /* persistence is best-effort */
  }
}

/**
 * Which PTZ pad events may pass, given the interaction mode. Discrete steps and the safety
 * panend/stop ALWAYS pass; continuous pan requires the opt-in AND a live (non-still-refresh) feed —
 * dragging against ~1 fps means steering blind between frames.
 */
export function allowPadEvent(
  type: string,
  opts: { continuous: boolean; delayed: boolean },
): boolean {
  if (type === 'step' || type === 'panend') {
    return true;
  }
  return opts.continuous && !opts.delayed;
}
