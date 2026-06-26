import { Discovery, type DiscoveredDevice } from 'onvif';
import type { DiscoveryProbe } from './discovery-service';
import type { IRawDiscovery } from './normalize';

/** Adapts an onvif Discovery device into our transport-neutral raw discovery shape. Pure/testable. */
export function adaptOnvifDevice(device: DiscoveredDevice): IRawDiscovery {
  const xaddr = device.xaddrs?.find((x) => typeof x?.href === 'string')?.href;
  const port = device.port === undefined || device.port === null ? undefined : Number(device.port);
  return {
    xaddr: xaddr ?? undefined,
    hostname: device.hostname ?? undefined,
    port: Number.isFinite(port) ? port : undefined,
  };
}

/** The raw onvif probe call, injectable so the wrapper can be tested without real multicast. */
export type OnvifProbe = typeof Discovery.probe;

/**
 * A WS-Discovery probe (ONVIF devices answer a multicast SOAP probe on 239.255.255.250:3702).
 * It always resolves — never rejects — so a discovery scan tolerates a dead network.
 */
export function createWsDiscoveryProbe(probe: OnvifProbe = Discovery.probe): DiscoveryProbe {
  return (timeoutMs: number) =>
    new Promise<IRawDiscovery[]>((resolve) => {
      let settled = false;
      const finish = (devices: DiscoveredDevice[]): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(devices.map(adaptOnvifDevice));
      };

      // Backstop in case the underlying callback never fires.
      const safety = setTimeout(() => finish([]), timeoutMs + 1000);
      safety.unref?.();

      try {
        probe({ timeout: timeoutMs, resolve: true }, (err, devices) => {
          finish(err || !Array.isArray(devices) ? [] : devices);
        });
      } catch {
        finish([]);
      }
    });
}
