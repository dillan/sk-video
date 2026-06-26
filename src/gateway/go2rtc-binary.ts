import { createHash } from 'node:crypto';

/** Pinned go2rtc version this plugin downloads and runs. */
export const GO2RTC_VERSION = '1.9.9';

/** Verifies a downloaded binary against an expected SHA-256 hex digest (case-insensitive). */
export function verifySha256(data: Buffer, expectedHex: string): boolean {
  const actual = createHash('sha256').update(data).digest('hex');
  return actual.toLowerCase() === expectedHex.toLowerCase();
}

/**
 * Maps a Node platform + arch to the go2rtc release asset name, or null if unsupported.
 * Mirrors the asset names published at github.com/AlexxIT/go2rtc/releases.
 */
const ASSETS: Record<string, Record<string, string>> = {
  darwin: { x64: 'go2rtc_mac_amd64', arm64: 'go2rtc_mac_arm64' },
  linux: { x64: 'go2rtc_linux_amd64', arm64: 'go2rtc_linux_arm64', arm: 'go2rtc_linux_arm', ia32: 'go2rtc_linux_i386' },
  win32: { x64: 'go2rtc_win64.exe', ia32: 'go2rtc_win32.exe', arm64: 'go2rtc_win_arm64.exe' }
};

export function go2rtcAssetName(platform: NodeJS.Platform, arch: string): string | null {
  return ASSETS[platform]?.[arch] ?? null;
}

/** Builds the GitHub release download URL for a go2rtc asset, or null if the platform is unsupported. */
export function go2rtcDownloadUrl(version: string, platform: NodeJS.Platform, arch: string): string | null {
  const asset = go2rtcAssetName(platform, arch);
  if (!asset) {
    return null;
  }
  return `https://github.com/AlexxIT/go2rtc/releases/download/v${version}/${asset}`;
}
