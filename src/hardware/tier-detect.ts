/**
 * Detects a coarse hardware tier so capability-heavy features (recording channels, hardware
 * snapshots, on-device analytics) self-limit instead of melting a fanless Cerbo or over-promising on
 * a Pi. The tier is a SOFT recommendation: it is injectable + operator-overridable, and a present
 * accelerator device node is NOT proof of a working driver — never sold as a guaranteed frame rate.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
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

export function detectHardware(_options: ITierDetectOptions = {}): IHardwareInfo {
  return {
    tier: 'minimal',
    overridden: false,
    arch: '',
    cores: 0,
    totalMemMB: 0,
    hwEncode: false,
    accelerator: null,
    capabilities: {
      recording: false,
      hardwareSnapshots: false,
      onDeviceAnalytics: false,
      maxRecordingChannels: 0,
    },
  };
}

export function describeTier(_info: IHardwareInfo): string {
  return '';
}
