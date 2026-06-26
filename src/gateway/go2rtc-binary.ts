/** Pinned go2rtc version this plugin downloads and runs. */
export const GO2RTC_VERSION = '1.9.9';

/**
 * Maps a Node platform + arch to the go2rtc release asset name, or null if unsupported.
 * Mirrors the asset names published at github.com/AlexxIT/go2rtc/releases.
 */
export function go2rtcAssetName(platform: NodeJS.Platform, arch: string): string | null {
  void platform;
  void arch;
  // RED stub.
  return null;
}

/** Builds the GitHub release download URL for a go2rtc asset, or null if the platform is unsupported. */
export function go2rtcDownloadUrl(version: string, platform: NodeJS.Platform, arch: string): string | null {
  void version;
  void platform;
  void arch;
  // RED stub.
  return null;
}
