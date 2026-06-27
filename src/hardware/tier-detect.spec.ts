import { describe, it, expect } from 'vitest';
import { detectHardware, describeTier } from './tier-detect';

const MB = 1024 * 1024;

function detect(
  host: { arch: string; cores: number; totalMemMB: number },
  devices: string[] = [],
  override?: Parameters<typeof detectHardware>[0] extends infer O
    ? O extends { override?: infer T }
      ? T
      : never
    : never,
) {
  const set = new Set(devices);
  return detectHardware({
    override,
    host: () => ({ arch: host.arch, cores: host.cores, totalMemBytes: host.totalMemMB * MB }),
    deviceExists: (p) => set.has(p),
  });
}

describe('detectHardware', () => {
  it('classifies a Cerbo-class device as minimal (streaming only)', () => {
    const info = detect({ arch: 'arm', cores: 2, totalMemMB: 512 });
    expect(info.tier).toBe('minimal');
    expect(info.capabilities).toMatchObject({
      recording: false,
      onDeviceAnalytics: false,
      maxRecordingChannels: 0,
    });
  });

  it('classifies a Pi4-class device as pi4 (recording, no analytics)', () => {
    const info = detect({ arch: 'arm64', cores: 4, totalMemMB: 2048 });
    expect(info.tier).toBe('pi4');
    expect(info.capabilities).toMatchObject({
      recording: true,
      onDeviceAnalytics: false,
      hardwareSnapshots: false, // no VAAPI node
    });
  });

  it('reports hardware snapshots when a VAAPI render node is present', () => {
    const info = detect({ arch: 'arm64', cores: 4, totalMemMB: 4096 }, ['/dev/dri/renderD128']);
    expect(info.hwEncode).toBe(true);
    expect(info.capabilities.hardwareSnapshots).toBe(true);
  });

  it('classifies an accelerator-equipped device as accelerated (analytics on)', () => {
    const info = detect({ arch: 'arm64', cores: 4, totalMemMB: 8192 }, ['/dev/hailo0']);
    expect(info.tier).toBe('accelerated');
    expect(info.accelerator).toBe('hailo');
    expect(info.capabilities.onDeviceAnalytics).toBe(true);
    expect(info.capabilities.maxRecordingChannels).toBeGreaterThan(0);
  });

  it('detects a Coral edge TPU device node', () => {
    expect(detect({ arch: 'arm64', cores: 4, totalMemMB: 8192 }, ['/dev/apex_0']).accelerator).toBe(
      'coral',
    );
  });

  it('classifies x86_64 as the top tier with analytics', () => {
    const info = detect({ arch: 'x64', cores: 8, totalMemMB: 16384 });
    expect(info.tier).toBe('x86');
    expect(info.capabilities.onDeviceAnalytics).toBe(true);
  });

  it('honours an operator override and flags it, keeping the detected facts', () => {
    const info = detect({ arch: 'arm', cores: 1, totalMemMB: 512 }, [], 'x86');
    expect(info.tier).toBe('x86');
    expect(info.overridden).toBe(true);
    expect(info.arch).toBe('arm'); // detected facts preserved
    expect(info.capabilities.onDeviceAnalytics).toBe(true);
  });

  it('does not flag an override that matches the detected tier', () => {
    const info = detect({ arch: 'x64', cores: 8, totalMemMB: 16384 }, [], 'x86');
    expect(info.overridden).toBe(false);
  });
});

describe('describeTier', () => {
  it('summarises the tier, resources and enabled features', () => {
    const info = detect({ arch: 'x64', cores: 8, totalMemMB: 16384 });
    const text = describeTier(info);
    expect(text).toContain('x86');
    expect(text).toContain('8 cores');
    expect(text).toMatch(/recording|analytics/);
  });

  it('marks an overridden tier', () => {
    const info = detect({ arch: 'arm', cores: 1, totalMemMB: 512 }, [], 'x86');
    expect(describeTier(info)).toContain('overridden');
  });

  it('says "streaming only" for a minimal tier with no features or accelerator', () => {
    const text = describeTier(detect({ arch: 'arm', cores: 1, totalMemMB: 512 }));
    expect(text).toContain('minimal');
    expect(text).toContain('streaming only');
    expect(text).not.toContain('overridden');
  });

  it('names the accelerator and HW snapshots when present', () => {
    const text = describeTier(
      detect({ arch: 'arm64', cores: 4, totalMemMB: 8192 }, ['/dev/hailo0', '/dev/dri/renderD128']),
    );
    expect(text).toContain('hailo');
    expect(text).toContain('HW snapshots');
    expect(text).toContain('analytics');
  });
});

describe('detectHardware (real host)', () => {
  it('reads node:os and fs by default without throwing', () => {
    const info = detectHardware();
    expect(typeof info.arch).toBe('string');
    expect(info.cores).toBeGreaterThan(0);
    expect(info.totalMemMB).toBeGreaterThan(0);
  });
});
