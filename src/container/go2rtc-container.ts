import type {
  AppLike,
  ContainerManagerApi,
  ManagedContainer as TManagedContainer,
} from 'signalk-container-helper';
import { DEFAULT_GO2RTC_PORTS } from '../gateway/go2rtc-config';
import { GO2RTC_CONTAINER_IMAGE, GO2RTC_CONTAINER_TAG } from '../gateway/go2rtc-image';

export const PLUGIN_ID = 'sk-video';
export const PLUGIN_NAME = 'SK Video';
export const GO2RTC_CONTAINER_NAME = 'video-gateway';
const CONTAINER_PLUGIN_DATA_DIR = '/sk-video-data';

export type TContainerHelper = typeof import('signalk-container-helper');

export interface IContainerRuntime {
  manager: ContainerManagerApi;
  createGo2rtcContainer(log?: (msg: string) => void): TManagedContainer;
}

let helperPromise: Promise<TContainerHelper> | null = null;

export function loadContainerHelper(): Promise<TContainerHelper> {
  if (!helperPromise) {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<TContainerHelper>;
    helperPromise = dynamicImport('signalk-container-helper');
  }
  return helperPromise;
}

export async function createContainerRuntime(
  app: AppLike,
  dataDir: string,
  signal?: AbortSignal,
  helperOverride?: TContainerHelper,
): Promise<IContainerRuntime> {
  const helper = helperOverride ?? (await loadContainerHelper());
  const { manager, runtime } = await helper.waitForContainerManager({
    timeoutMs: 120_000,
    signal,
    onWaiting: (phase) => {
      app.setPluginStatus(
        phase === 'manager'
          ? 'Waiting for signalk-container plugin...'
          : 'Waiting for container runtime detection...',
      );
    },
  });

  if (!manager) {
    throw new Error(
      'signalk-container plugin not available. Install and enable it, then restart this plugin.',
    );
  }
  if (!runtime) {
    throw new Error('No container runtime detected (Podman or Docker).');
  }
  const dataMount = await helper.resolveMount(manager, {
    containerPath: CONTAINER_PLUGIN_DATA_DIR,
    hostPath: dataDir,
  });
  const go2rtcConfigPath = `${dataMount.containerPath}/go2rtc.yaml`;

  return {
    manager,
    createGo2rtcContainer(log = () => undefined) {
      return new helper.ManagedContainer({
        app,
        pluginId: PLUGIN_ID,
        name: GO2RTC_CONTAINER_NAME,
        image: GO2RTC_CONTAINER_IMAGE,
        defaultTag: GO2RTC_CONTAINER_TAG,
        buildConfig: (tag) => ({
          image: GO2RTC_CONTAINER_IMAGE,
          tag,
          command: ['go2rtc', '-config', go2rtcConfigPath],
          volumes: { [CONTAINER_PLUGIN_DATA_DIR]: dataMount.source },
          ports: {
            [`${DEFAULT_GO2RTC_PORTS.webrtc}/tcp`]: `0.0.0.0:${DEFAULT_GO2RTC_PORTS.webrtc}`,
            [`${DEFAULT_GO2RTC_PORTS.webrtc}/udp`]: `0.0.0.0:${DEFAULT_GO2RTC_PORTS.webrtc}`,
          },
          signalkAccessiblePorts: [DEFAULT_GO2RTC_PORTS.api],
          restart: 'unless-stopped',
        }),
        readiness: {
          port: DEFAULT_GO2RTC_PORTS.api,
          path: '/api/streams',
          maxMs: 60_000,
        },
        ensureOptions: {
          pluginId: PLUGIN_ID,
          onContainerLog: (line) => log(`go2rtc container: ${line}`),
        },
      });
    },
  };
}
