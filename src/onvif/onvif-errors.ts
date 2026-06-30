/**
 * Turn a raw ONVIF/network failure into an honest, actionable reason for the operator. The PTZ and
 * imaging routes both reach the camera over ONVIF, and a bare "PTZ command failed" tells the user
 * nothing they can act on — this maps the common failure modes to a next step.
 */
export type TOnvifFailureReason = 'unreachable' | 'auth' | 'onvif' | 'unknown';

export interface IOnvifFailure {
  reason: TOnvifFailureReason;
  /** A short, operator-facing next step. */
  hint: string;
}

export function categorizeOnvifError(err: unknown): IOnvifFailure {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();

  if (
    /enotfound|eai_again|econnrefused|ehostunreach|enetunreach|etimedout|timed?\s?out|socket hang up/.test(
      msg,
    )
  ) {
    return {
      reason: 'unreachable',
      hint: "Can't reach this camera's ONVIF service. Check it's powered on and on the network, and that ONVIF is enabled in the camera's settings.",
    };
  }
  if (
    /not authori|unauthor|forbidden|401|403|sender not|invalid.*(user|pass)|authentication/.test(
      msg,
    )
  ) {
    return {
      reason: 'auth',
      hint: 'The camera rejected the login for ONVIF control. Re-enter the camera credentials under Cameras.',
    };
  }
  // A wrong/garbage SOAP response means we reached something that isn't the ONVIF service — usually the
  // camera's web UI on the wrong port, or ONVIF turned off.
  if (/wrong onvif soap|soap|xml|unexpected|parse|invalid response/.test(msg)) {
    return {
      reason: 'onvif',
      hint: "Reached the camera but not its ONVIF service. Enable ONVIF on the camera (some models call it 'ONVIF' or 'RTSP/ONVIF'); it may use a non-standard port.",
    };
  }
  return {
    reason: 'unknown',
    hint: 'The camera control failed. Check the camera is online and ONVIF is enabled, then try again.',
  };
}
