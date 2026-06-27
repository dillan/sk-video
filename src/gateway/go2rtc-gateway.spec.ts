import { describe, it, expect, beforeEach } from 'vitest';
import { Go2rtcGateway, type IProcessController } from './go2rtc-gateway';
import { DEFAULT_GO2RTC_PORTS } from './go2rtc-config';
import type { ICamera } from '../cameras/camera-validation';

class FakeProcess implements IProcessController {
  calls: string[] = [];
  running = false;
  start() {
    this.calls.push('start');
    this.running = true;
  }
  restart() {
    this.calls.push('restart');
  }
  async stop() {
    this.calls.push('stop');
    this.running = false;
  }
}

const enabledCam: ICamera = { name: 'A', enabled: true, source: { scheme: 'rtsp', host: 'cam1' } };
const disabledCam: ICamera = {
  name: 'B',
  enabled: false,
  source: { scheme: 'rtsp', host: 'cam2' },
};

function makeGateway(proc: IProcessController) {
  const writes: Record<string, unknown>[] = [];
  const removes: string[] = [];
  const binary = { ensure: async () => '/bin/go2rtc' };
  const gateway = new Go2rtcGateway({
    dataDir: '/data',
    binary,
    process: proc,
    writeConfig: (_path, cfg) => writes.push(cfg),
    removeConfig: (path) => removes.push(path),
  });
  return { gateway, writes, removes };
}

describe('Go2rtcGateway.sync', () => {
  let proc: FakeProcess;

  beforeEach(() => {
    proc = new FakeProcess();
  });

  it('writes the config and starts go2rtc when a camera is enabled', async () => {
    const { gateway, writes } = makeGateway(proc);
    await gateway.sync({ a: enabledCam }, {});
    expect(writes).toHaveLength(1);
    expect(writes[0].streams as object).toEqual({ a: 'rtsp://cam1' });
    expect(proc.calls).toEqual(['start']);
  });

  it('restarts go2rtc on a change when it is already running', async () => {
    const { gateway } = makeGateway(proc);
    await gateway.sync({ a: enabledCam }, {});
    await gateway.sync({ a: enabledCam }, {});
    expect(proc.calls).toEqual(['start', 'restart']);
  });

  it('stops go2rtc (and never starts) when no camera is enabled', async () => {
    const { gateway, writes } = makeGateway(proc);
    await gateway.sync({ b: disabledCam }, {});
    expect(writes).toHaveLength(0);
    expect(proc.calls).toEqual(['stop']);
  });

  // SECURITY: when the last camera is removed, the on-disk config still holds credential-bearing
  // stream URLs. Stopping go2rtc isn't enough — the stale config must be removed so no secret is
  // left at rest.
  it('removes the stale config file when no camera is enabled', async () => {
    const { gateway, removes } = makeGateway(proc);
    await gateway.sync({ b: disabledCam }, {});
    expect(removes).toEqual(['/data/go2rtc.yaml']);
  });

  it('does not remove the config while a camera is still enabled', async () => {
    const { gateway, removes } = makeGateway(proc);
    await gateway.sync({ a: enabledCam }, {});
    expect(removes).toEqual([]);
  });
});

describe('Go2rtcGateway.stop', () => {
  it('tears down the running process when called directly', async () => {
    const proc = new FakeProcess();
    const { gateway } = makeGateway(proc);
    // Bring go2rtc up first so there is a live process (and bound ports) to tear down.
    await gateway.sync({ a: enabledCam }, {});
    expect(proc.running).toBe(true);

    await gateway.stop();

    // The injected controller's stop() ran and the process is no longer running
    // (the controller releases its ports as part of stopping).
    expect(proc.calls).toEqual(['start', 'stop']);
    expect(proc.running).toBe(false);
  });
});

describe('Go2rtcGateway.apiPort', () => {
  it('returns the custom api port when constructed with non-default ports', () => {
    const proc = new FakeProcess();
    const customApi = DEFAULT_GO2RTC_PORTS.api + 1000;
    const gateway = new Go2rtcGateway({
      dataDir: '/data',
      binary: { ensure: async () => '/bin/go2rtc' },
      process: proc,
      ports: { api: customApi, rtsp: 9554, webrtc: 9555 },
      writeConfig: () => {},
    });
    expect(gateway.apiPort).toBe(customApi);
    expect(gateway.apiPort).not.toBe(DEFAULT_GO2RTC_PORTS.api);
  });

  it('falls back to the default api port when no ports are provided', () => {
    const { gateway } = makeGateway(new FakeProcess());
    expect(gateway.apiPort).toBe(DEFAULT_GO2RTC_PORTS.api);
  });
});
