import { describe, expect, it, vi } from 'vitest';
import { Go2rtcContainerProcess } from './go2rtc-container-process';
import { GO2RTC_CONTAINER_TAG } from './go2rtc-image';

function container(address = 'http://sk-video-gateway:1984') {
  return {
    start: vi.fn().mockResolvedValue({ address }),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Go2rtcContainerProcess', () => {
  it('starts go2rtc through signalk-container-helper and exposes the resolved API URL', async () => {
    const c = container();
    const proc = new Go2rtcContainerProcess({
      container: c as never,
    });

    await proc.start('ignored', '/home/node/.signalk/plugin-config-data/sk-video/go2rtc.yaml');

    expect(c.start).toHaveBeenCalledWith(GO2RTC_CONTAINER_TAG);
    expect(proc.apiBaseUrl).toBe('http://sk-video-gateway:1984');
    expect(proc.running).toBe(true);
  });

  it('stops and starts the managed container on restart', async () => {
    const c = container();
    const proc = new Go2rtcContainerProcess({
      container: c as never,
    });

    await proc.start('ignored', '/data/go2rtc.yaml');
    await proc.restart('ignored', '/data/go2rtc.yaml');

    expect(c.stop).toHaveBeenCalledTimes(1);
    expect(c.start).toHaveBeenCalledTimes(2);
  });

  it('clears the running state and API URL on stop', async () => {
    const c = container();
    const proc = new Go2rtcContainerProcess({
      container: c as never,
    });

    await proc.start('ignored', '/data/go2rtc.yaml');
    await proc.stop();

    expect(c.stop).toHaveBeenCalledTimes(1);
    expect(proc.running).toBe(false);
    expect(proc.apiBaseUrl).toBeUndefined();
  });

  it('throws a clear error when signalk-container-helper cannot resolve an address', async () => {
    const proc = new Go2rtcContainerProcess({
      container: container(null as never) as never,
    });

    await expect(proc.start('ignored', '/data/go2rtc.yaml')).rejects.toThrow(/go2rtc API port/);
  });
});
