import { describe, expect, it, vi } from 'vitest';
import {
  createContainerRuntime,
  GO2RTC_CONTAINER_NAME,
  PLUGIN_ID,
  type TContainerHelper,
} from './go2rtc-container';
import { DEFAULT_GO2RTC_PORTS } from '../gateway/go2rtc-config';
import { GO2RTC_CONTAINER_IMAGE, GO2RTC_CONTAINER_TAG } from '../gateway/go2rtc-image';

function app() {
  return {
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    debug: vi.fn(),
  };
}

describe('createContainerRuntime', () => {
  it('waits for signalk-container and creates a pinned managed go2rtc container', async () => {
    const ManagedContainer = vi.fn();
    const manager = { runJob: vi.fn() };
    const dataDir = '/home/node/.signalk/plugin-config-data/sk-video';
    const a = app();
    const helper = {
      waitForContainerManager: vi.fn().mockResolvedValue({
        manager,
        runtime: { runtime: 'docker', version: '1.0.0' },
      }),
      resolveMount: vi.fn().mockResolvedValue({
        source: 'signalk-config',
        containerPath: '/sk-video-data/plugin-config-data/sk-video',
        subPath: 'plugin-config-data/sk-video',
      }),
      ManagedContainer,
    } as unknown as TContainerHelper;

    const runtime = await createContainerRuntime(a, dataDir, undefined, helper);
    runtime.createGo2rtcContainer();

    expect(runtime.manager).toBe(manager);
    expect(helper.waitForContainerManager).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
    expect(ManagedContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        app: a,
        pluginId: PLUGIN_ID,
        name: GO2RTC_CONTAINER_NAME,
        image: GO2RTC_CONTAINER_IMAGE,
        defaultTag: GO2RTC_CONTAINER_TAG,
        readiness: {
          port: DEFAULT_GO2RTC_PORTS.api,
          path: '/api/streams',
          maxMs: 60_000,
        },
      }),
    );
    expect(helper.resolveMount).toHaveBeenCalledWith(manager, {
      containerPath: '/sk-video-data',
      hostPath: dataDir,
    });
    const opts = ManagedContainer.mock.calls[0][0] as {
      buildConfig: (tag: string) => Record<string, unknown>;
      ensureOptions: { pluginId: string };
    };
    expect(opts.buildConfig('test-tag')).toEqual({
      image: GO2RTC_CONTAINER_IMAGE,
      tag: 'test-tag',
      command: ['go2rtc', '-config', `/sk-video-data/plugin-config-data/${PLUGIN_ID}/go2rtc.yaml`],
      volumes: {
        '/sk-video-data': 'signalk-config',
      },
      ports: {
        [`${DEFAULT_GO2RTC_PORTS.webrtc}/tcp`]: `0.0.0.0:${DEFAULT_GO2RTC_PORTS.webrtc}`,
        [`${DEFAULT_GO2RTC_PORTS.webrtc}/udp`]: `0.0.0.0:${DEFAULT_GO2RTC_PORTS.webrtc}`,
      },
      signalkAccessiblePorts: [DEFAULT_GO2RTC_PORTS.api],
      restart: 'unless-stopped',
    });
    expect(opts.ensureOptions.pluginId).toBe(PLUGIN_ID);
  });

  it('fails clearly when signalk-container is unavailable', async () => {
    const helper = {
      waitForContainerManager: vi.fn().mockResolvedValue({ manager: undefined, runtime: null }),
    } as unknown as TContainerHelper;

    await expect(
      createContainerRuntime(app(), '/data/sk-video', undefined, helper),
    ).rejects.toThrow(/signalk-container plugin not available/);
  });

  it('fails clearly when no container runtime is detected', async () => {
    const helper = {
      waitForContainerManager: vi.fn().mockResolvedValue({ manager: {}, runtime: null }),
    } as unknown as TContainerHelper;

    await expect(
      createContainerRuntime(app(), '/data/sk-video', undefined, helper),
    ).rejects.toThrow(/Podman or Docker/);
  });
});
