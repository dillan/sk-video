import type { IFfprobeOutcome, TFfprobeRunner } from './probe';
import type { ContainerManagerApi } from 'signalk-container-helper';
import { GO2RTC_CONTAINER_REF } from '../gateway/go2rtc-image';
import { PLUGIN_ID } from '../container/go2rtc-container';

/**
 * Runs ffprobe inside the configured go2rtc container image. The official go2rtc image includes
 * FFmpeg/ffprobe, so the whole video toolchain stays outside the Signal K image.
 */
export function createContainerFfprobeRunner(
  manager: ContainerManagerApi,
  log: (msg: string) => void = () => undefined,
): TFfprobeRunner {
  return async (args, timeoutMs): Promise<IFfprobeOutcome> => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await manager.runJob({
      image: GO2RTC_CONTAINER_REF,
      entrypoint: ['ffprobe'],
      command: args,
      timeout: Math.ceil(timeoutMs / 1000) + 2,
      label: 'ffprobe',
      ownerPluginId: PLUGIN_ID,
      onStdoutLine: (line) => stdout.push(line),
      onStderrLine: (line) => stderr.push(line),
    });
    if (result.status === 'cancelled') {
      return { code: 1, timedOut: true, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
    }
    if (result.status !== 'completed') {
      log(`container ffprobe failed: ${result.error ?? result.log.join('\n')}`);
      return { code: 1, timedOut: false, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
    }
    return {
      code: result.exitCode ?? 0,
      timedOut: false,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  };
}
