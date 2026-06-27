/**
 * A small, curated table of common RTSP paths by manufacturer, used to SUGGEST a stream path when a
 * camera does not speak clean ONVIF media (so onboarding still feels zero-config instead of dropping
 * the user into a vendor manual). A suggestion is only ever offered behind a live connection test —
 * a wrong guess never persists. The table is best-effort and never exhaustive.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface IRtspPathGuess {
  /** Main (high quality) stream path. */
  main: string;
  /** Optional low-bandwidth substream path. */
  sub?: string;
}

/** Returns candidate RTSP paths for a manufacturer/model string, or null if unknown. */
export function guessRtspPaths(_manufacturerOrModel: string): IRtspPathGuess | null {
  return null;
}
