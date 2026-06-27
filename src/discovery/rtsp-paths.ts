/**
 * A small, curated table of common RTSP paths by manufacturer, used to SUGGEST a stream path when a
 * camera does not speak clean ONVIF media (so onboarding still feels zero-config instead of dropping
 * the user into a vendor manual). A suggestion is only ever offered behind a live connection test —
 * a wrong guess never persists. The table is best-effort and never exhaustive.
 */

export interface IRtspPathGuess {
  /** Main (high quality) stream path. */
  main: string;
  /** Optional low-bandwidth substream path. */
  sub?: string;
}

const TABLE: [RegExp, IRtspPathGuess][] = [
  [/hikvision/i, { main: '/Streaming/Channels/101', sub: '/Streaming/Channels/102' }],
  [
    /dahua|amcrest|lorex/i,
    { main: '/cam/realmonitor?channel=1&subtype=0', sub: '/cam/realmonitor?channel=1&subtype=1' },
  ],
  [/\baxis\b/i, { main: '/axis-media/media.amp' }],
  [/reolink/i, { main: '/h264Preview_01_main', sub: '/h264Preview_01_sub' }],
  [/foscam/i, { main: '/videoMain', sub: '/videoSub' }],
  [/hanwha|wisenet|samsung/i, { main: '/profile1/media.smp', sub: '/profile2/media.smp' }],
  [/ubiquiti|unifi/i, { main: '/s0', sub: '/s1' }],
  [/vivotek/i, { main: '/live.sdp' }],
];

/** Returns candidate RTSP paths for a manufacturer/model string, or null if unknown. */
export function guessRtspPaths(manufacturerOrModel: string): IRtspPathGuess | null {
  if (!manufacturerOrModel) {
    return null;
  }
  return TABLE.find(([re]) => re.test(manufacturerOrModel))?.[1] ?? null;
}
