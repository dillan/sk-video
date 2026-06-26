import { describe, it, expect } from 'vitest';
import { isIpAllowed, assertHostAllowed } from './ssrf-guard';

const deny = { allowPrivate: false };
const allowLan = { allowPrivate: true };

describe('isIpAllowed', () => {
  it('always denies loopback', () => {
    for (const ip of ['127.0.0.1', '127.0.0.5', '::1']) {
      expect(isIpAllowed(ip, allowLan), ip).toBe(false);
    }
  });

  it('always denies link-local and the cloud-metadata address', () => {
    for (const ip of ['169.254.169.254', '169.254.0.1', 'fe80::1']) {
      expect(isIpAllowed(ip, allowLan), ip).toBe(false);
    }
  });

  it('always denies the unspecified address', () => {
    expect(isIpAllowed('0.0.0.0', allowLan)).toBe(false);
    expect(isIpAllowed('::', allowLan)).toBe(false);
  });

  it('denies private ranges by default', () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '192.168.1.50', 'fc00::1']) {
      expect(isIpAllowed(ip, deny), ip).toBe(false);
    }
  });

  it('allows private ranges only when opted in', () => {
    expect(isIpAllowed('192.168.1.50', allowLan)).toBe(true);
    expect(isIpAllowed('10.0.0.5', allowLan)).toBe(true);
  });

  it('allows public addresses regardless of the private flag', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isIpAllowed(ip, deny), ip).toBe(true);
    }
  });

  it('denies anything that is not a valid IP literal', () => {
    for (const bad of ['', 'not-an-ip', '999.1.1.1', 'cam.local']) {
      expect(isIpAllowed(bad, allowLan), bad).toBe(false);
    }
  });
});

describe('assertHostAllowed', () => {
  const lookup = (map: Record<string, string[]>) => async (host: string) => map[host] ?? [];

  it('passes an IP literal that is allowed without resolving', async () => {
    let called = false;
    await expect(
      assertHostAllowed('192.168.1.50', allowLan, async () => {
        called = true;
        return [];
      }),
    ).resolves.toBeUndefined();
    expect(called).toBe(false);
  });

  it('rejects a blocked IP literal', async () => {
    await expect(assertHostAllowed('127.0.0.1', allowLan, lookup({}))).rejects.toThrow();
  });

  it('resolves a hostname and passes when every address is allowed', async () => {
    await expect(
      assertHostAllowed('cam.example', deny, lookup({ 'cam.example': ['8.8.8.8'] })),
    ).resolves.toBeUndefined();
  });

  it('rejects when any resolved address is blocked (DNS rebinding defense)', async () => {
    await expect(
      assertHostAllowed('evil.example', deny, lookup({ 'evil.example': ['8.8.8.8', '127.0.0.1'] })),
    ).rejects.toThrow();
  });

  it('rejects an unresolvable host', async () => {
    await expect(assertHostAllowed('nope.example', deny, lookup({}))).rejects.toThrow();
  });
});
