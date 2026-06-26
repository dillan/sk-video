import { describe, it, expect } from 'vitest';
import { go2rtcAssetName, go2rtcDownloadUrl, verifySha256 } from './go2rtc-binary';

describe('verifySha256', () => {
  // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
  const HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

  it('accepts a matching digest (case-insensitive)', () => {
    expect(verifySha256(Buffer.from('hello'), HELLO)).toBe(true);
    expect(verifySha256(Buffer.from('hello'), HELLO.toUpperCase())).toBe(true);
  });

  it('rejects a mismatched digest', () => {
    expect(verifySha256(Buffer.from('hello'), '0'.repeat(64))).toBe(false);
    expect(verifySha256(Buffer.from('world'), HELLO)).toBe(false);
  });
});

describe('go2rtcAssetName', () => {
  it('maps the common platforms', () => {
    expect(go2rtcAssetName('darwin', 'arm64')).toBe('go2rtc_mac_arm64');
    expect(go2rtcAssetName('darwin', 'x64')).toBe('go2rtc_mac_amd64');
    expect(go2rtcAssetName('linux', 'x64')).toBe('go2rtc_linux_amd64');
    expect(go2rtcAssetName('linux', 'arm64')).toBe('go2rtc_linux_arm64');
    expect(go2rtcAssetName('linux', 'arm')).toBe('go2rtc_linux_arm');
    expect(go2rtcAssetName('win32', 'x64')).toBe('go2rtc_win64.exe');
  });

  it('returns null for unsupported platforms/arches', () => {
    expect(go2rtcAssetName('sunos', 'x64')).toBeNull();
    expect(go2rtcAssetName('linux', 'mips')).toBeNull();
  });
});

describe('go2rtcDownloadUrl', () => {
  it('builds the GitHub release URL for a version + platform', () => {
    expect(go2rtcDownloadUrl('1.9.9', 'linux', 'x64'))
      .toBe('https://github.com/AlexxIT/go2rtc/releases/download/v1.9.9/go2rtc_linux_amd64');
  });

  it('is null when the platform is unsupported', () => {
    expect(go2rtcDownloadUrl('1.9.9', 'sunos', 'x64')).toBeNull();
  });
});
