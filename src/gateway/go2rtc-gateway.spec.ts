import { describe, it, expect, beforeEach } from 'vitest';
import { Go2rtcGateway, type IProcessController } from './go2rtc-gateway';
import type { ICamera } from '../cameras/camera-validation';

class FakeProcess implements IProcessController {
  calls: string[] = [];
  running = false;
  start() { this.calls.push('start'); this.running = true; }
  restart() { this.calls.push('restart'); }
  async stop() { this.calls.push('stop'); this.running = false; }
}

const enabledCam: ICamera = { name: 'A', enabled: true, source: { scheme: 'rtsp', host: 'cam1' } };
const disabledCam: ICamera = { name: 'B', enabled: false, source: { scheme: 'rtsp', host: 'cam2' } };

function makeGateway(proc: IProcessController) {
  const writes: Record<string, unknown>[] = [];
  const binary = { ensure: async () => '/bin/go2rtc' };
  const gateway = new Go2rtcGateway({
    dataDir: '/data',
    binary,
    process: proc,
    writeConfig: (_path, cfg) => writes.push(cfg)
  });
  return { gateway, writes };
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
    expect((writes[0].streams as object)).toEqual({ a: 'rtsp://cam1' });
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
});
