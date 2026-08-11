import { describe, expect, it, vi } from 'vitest';
import { createContainerFfprobeRunner } from './container-probe-runner';
import type { ContainerManagerApi } from 'signalk-container-helper';
import { PLUGIN_ID } from '../container/go2rtc-container';
import { GO2RTC_CONTAINER_REF } from '../gateway/go2rtc-image';

function manager(over: Partial<ContainerManagerApi> = {}): ContainerManagerApi {
  return {
    runJob: vi
      .fn()
      .mockImplementation(async (config: { onStdoutLine?: (line: string) => void }) => {
        config.onStdoutLine?.('{"streams":[{"codec_name":"h264","width":1920,"height":1080}]}');
        return {
          status: 'completed',
          exitCode: 0,
          log: [],
        };
      }),
    ...over,
  } as unknown as ContainerManagerApi;
}

describe('createContainerFfprobeRunner', () => {
  it('runs ffprobe through signalk-container using the pinned go2rtc image', async () => {
    const m = manager();
    const run = createContainerFfprobeRunner(m);

    const outcome = await run(['-of', 'json', 'rtsp://cam'], 8000);

    expect(m.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        image: GO2RTC_CONTAINER_REF,
        entrypoint: ['ffprobe'],
        command: ['-of', 'json', 'rtsp://cam'],
        label: 'ffprobe',
        ownerPluginId: PLUGIN_ID,
      }),
    );
    expect(outcome).toEqual({
      code: 0,
      timedOut: false,
      stdout: '{"streams":[{"codec_name":"h264","width":1920,"height":1080}]}',
      stderr: '',
    });
  });

  it('maps a cancelled container job to a timed out ffprobe outcome', async () => {
    const run = createContainerFfprobeRunner(
      manager({ runJob: vi.fn().mockResolvedValue({ status: 'cancelled', log: [] }) }),
    );

    await expect(run(['rtsp://cam'], 8000)).resolves.toMatchObject({
      code: 1,
      timedOut: true,
    });
  });

  it('maps a failed container job to a non-timeout ffprobe failure', async () => {
    const run = createContainerFfprobeRunner(
      manager({ runJob: vi.fn().mockResolvedValue({ status: 'failed', log: [], error: 'boom' }) }),
    );

    await expect(run(['rtsp://cam'], 8000)).resolves.toMatchObject({
      code: 1,
      timedOut: false,
    });
  });
});
