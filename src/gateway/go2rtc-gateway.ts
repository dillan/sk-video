import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ICamera } from '../cameras/camera-validation';
import type { ICameraCredentials } from './go2rtc-source';
import { buildGo2rtcConfig, DEFAULT_GO2RTC_PORTS, type IGo2rtcPorts } from './go2rtc-config';

/** Controls the go2rtc child process. */
export interface IProcessController {
  start(binaryPath: string, configPath: string): void;
  restart(binaryPath: string, configPath: string): void;
  stop(): Promise<void>;
  readonly running: boolean;
}

/** Provides the path to the go2rtc binary. */
export interface IBinaryProvider {
  ensure(): Promise<string>;
}

export interface IGo2rtcGatewayOptions {
  dataDir: string;
  binary: IBinaryProvider;
  process: IProcessController;
  ports?: IGo2rtcPorts;
  /** Injectable config writer for testing. */
  writeConfig?: (path: string, config: Record<string, unknown>) => void;
  log?: (msg: string) => void;
}

/**
 * Reconciles go2rtc with the configured cameras. go2rtc only runs while at least one camera is
 * enabled; the config (JSON, which go2rtc reads as YAML) is regenerated and go2rtc (re)started on any
 * change. The config and credentials never leave the server.
 */
export class Go2rtcGateway {
  private readonly configPath: string;

  constructor(private readonly opts: IGo2rtcGatewayOptions) {
    this.configPath = join(opts.dataDir, 'go2rtc.yaml');
  }

  get apiPort(): number {
    return (this.opts.ports ?? DEFAULT_GO2RTC_PORTS).api;
  }

  async sync(cameras: Record<string, ICamera>, credentials: Record<string, ICameraCredentials>): Promise<void> {
    const anyEnabled = Object.values(cameras).some((c) => c.enabled);
    if (!anyEnabled) {
      // Never run go2rtc with no cameras configured.
      await this.opts.process.stop();
      return;
    }

    const config = buildGo2rtcConfig({ cameras, credentials, ports: this.opts.ports });
    this.write(config);

    const binaryPath = await this.opts.binary.ensure();
    if (this.opts.process.running) {
      this.opts.process.restart(binaryPath, this.configPath);
    } else {
      this.opts.process.start(binaryPath, this.configPath);
    }
  }

  async stop(): Promise<void> {
    await this.opts.process.stop();
  }

  private write(config: Record<string, unknown>): void {
    const writer =
      this.opts.writeConfig ??
      ((path: string, cfg: Record<string, unknown>) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
      });
    writer(this.configPath, config);
  }
}
