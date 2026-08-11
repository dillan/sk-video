import type { IProcessController } from './go2rtc-gateway';
import type { ManagedContainer as TManagedContainer } from 'signalk-container-helper';
import { GO2RTC_CONTAINER_NAME } from '../container/go2rtc-container';
import { GO2RTC_CONTAINER_TAG } from './go2rtc-image';

export interface IGo2rtcContainerProcessOptions {
  container: TManagedContainer;
}

/**
 * Supervises go2rtc as a signalk-container-helper managed container. The Signal K plugin still owns
 * the browser-facing proxy; this only moves the video toolchain out of the Signal K process.
 */
export class Go2rtcContainerProcess implements IProcessController {
  private currentApiBaseUrl: string | undefined;
  private isRunning = false;

  constructor(private readonly opts: IGo2rtcContainerProcessOptions) {}

  get running(): boolean {
    return this.isRunning;
  }

  get apiBaseUrl(): string | undefined {
    return this.currentApiBaseUrl;
  }

  async start(_binaryPath: string, configPath: string): Promise<void> {
    await this.ensure(configPath);
  }

  async restart(_binaryPath: string, configPath: string): Promise<void> {
    await this.stop();
    await this.ensure(configPath);
  }

  async stop(): Promise<void> {
    await this.opts.container.stop();
    this.isRunning = false;
    this.currentApiBaseUrl = undefined;
  }

  private async ensure(_configPath: string): Promise<void> {
    const { address } = await this.opts.container.start(GO2RTC_CONTAINER_TAG);
    if (!address) {
      throw new Error('signalk-container did not expose the go2rtc API port');
    }
    this.currentApiBaseUrl = address;
    this.isRunning = true;
  }
}

export function go2rtcContainerName(): string {
  return GO2RTC_CONTAINER_NAME;
}
