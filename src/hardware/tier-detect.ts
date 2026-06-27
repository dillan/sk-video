import { arch as osArch, cpus, totalmem } from 'node:os';
import { existsSync } from 'node:fs';

/**
 * Detects a coarse hardware tier so capability-heavy features (recording channels, hardware
 * snapshots, on-device analytics) self-limit instead of melting a fanless Cerbo or over-promising on
 * a Pi. The tier is a SOFT recommendation: it is injectable + operator-overridable, and a present
 * accelerator device node is NOT proof of a working driver — never sold as a guaranteed frame rate.
 */

export type THardwareTier = 'minimal' | 'pi4' | 'accelerated' | 'x86';
export const TIER_ORDER: readonly THardwareTier[] = ['minimal', 'pi4', 'accelerated', 'x86'];

export type TAccelerator = 'coral' | 'hailo' | 'rockchip-npu';

export interface IHardwareCapabilities {
  /** Continuous / ring-buffer MP4 recording is advisable. */
  recording: boolean;
  /** Hardware-accelerated JPEG snapshots (#hardware) are available (a VAAPI render node exists). */
  hardwareSnapshots: boolean;
  /** On-device object detection (Frigate-class) is advisable. */
  onDeviceAnalytics: boolean;
  /** Suggested cap on simultaneous recording channels. */
  maxRecordingChannels: number;
}

export interface IHardwareInfo {
  tier: THardwareTier;
  /** True when `tier` was forced by the operator and differs from what was detected. */
  overridden: boolean;
  arch: string;
  cores: number;
  totalMemMB: number;
  hwEncode: boolean;
  accelerator: TAccelerator | null;
  capabilities: IHardwareCapabilities;
}

export interface ITierDetectOptions {
  /** Manual operator override; the detected facts are still reported. */
  override?: THardwareTier;
  /** Injectable host facts (defaults to node:os). */
  host?: () => { arch: string; cores: number; totalMemBytes: number };
  /** Injectable device-node probe (defaults to fs.existsSync). */
  deviceExists?: (path: string) => boolean;
}

// Heuristic device nodes — a present node is not proof of a working driver (see the file header).
const VAAPI_NODE = '/dev/dri/renderD128'; // VAAPI hardware encode
const ACCELERATOR_NODES: [string, TAccelerator][] = [
  ['/dev/apex_0', 'coral'], // Coral Edge TPU (M.2/PCIe; a USB Coral has no /dev node)
  ['/dev/hailo0', 'hailo'], // Hailo-8 / 8L
  ['/dev/rknpu', 'rockchip-npu'], // Rockchip RK3588-class NPU
];

const MIN_PI4_CORES = 4;
const MIN_PI4_MEM_MB = 1536;
const CHANNELS: Record<THardwareTier, number> = { minimal: 0, pi4: 2, accelerated: 3, x86: 6 };

export function detectHardware(options: ITierDetectOptions = {}): IHardwareInfo {
  const host =
    options.host ?? (() => ({ arch: osArch(), cores: cpus().length, totalMemBytes: totalmem() }));
  const deviceExists = options.deviceExists ?? existsSync;

  const { arch, cores, totalMemBytes } = host();
  const totalMemMB = Math.round(totalMemBytes / (1024 * 1024));
  const hwEncode = deviceExists(VAAPI_NODE);
  const accelerator = ACCELERATOR_NODES.find(([node]) => deviceExists(node))?.[1] ?? null;

  const detected = deriveTier(arch, cores, totalMemMB, accelerator);
  const tier = options.override ?? detected;

  return {
    tier,
    overridden: options.override !== undefined && options.override !== detected,
    arch,
    cores,
    totalMemMB,
    hwEncode,
    accelerator,
    capabilities: {
      recording: tier !== 'minimal',
      hardwareSnapshots: hwEncode && tier !== 'minimal',
      onDeviceAnalytics: tier === 'accelerated' || tier === 'x86',
      maxRecordingChannels: CHANNELS[tier],
    },
  };
}

function deriveTier(
  arch: string,
  cores: number,
  totalMemMB: number,
  accelerator: TAccelerator | null,
): THardwareTier {
  if (arch === 'x64') {
    return 'x86';
  }
  if (accelerator) {
    return 'accelerated';
  }
  if (cores >= MIN_PI4_CORES && totalMemMB >= MIN_PI4_MEM_MB) {
    return 'pi4';
  }
  return 'minimal';
}

/** A short, human-readable status line for setPluginStatus / the /status endpoint. */
export function describeTier(info: IHardwareInfo): string {
  const features = [
    info.capabilities.recording ? 'recording' : null,
    info.capabilities.hardwareSnapshots ? 'HW snapshots' : null,
    info.capabilities.onDeviceAnalytics ? 'analytics' : null,
  ].filter(Boolean);
  const gb = info.totalMemMB >= 1024 ? `${Math.round(info.totalMemMB / 1024)} GB` : '<1 GB';
  const accel = info.accelerator ? `, ${info.accelerator}` : '';
  const flag = info.overridden ? ' [overridden]' : '';
  const tail = features.length > 0 ? features.join(', ') : 'streaming only';
  return `${info.tier} (${info.cores} cores, ${gb}${accel})${flag} — ${tail}`;
}
