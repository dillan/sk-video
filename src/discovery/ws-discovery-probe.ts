import { Discovery } from 'onvif';
import type { DiscoveryProbe } from './discovery-service';
import type { IRawDiscovery } from './normalize';

/**
 * Adapts a RAW onvif WS-Discovery probe-match into our transport-neutral discovery shape. We run the
 * probe with `resolve:false` so the onvif library does NOT build a Cam (which would auto-CONNECT to the
 * device's advertised XAddr — a blind SSRF to an attacker-controlled host that bypasses the egress
 * guard). Instead we parse the raw ProbeMatch defensively; the resolved XAddr is re-validated through
 * the SSRF guard downstream before anything connects to it.
 */
export function adaptOnvifDevice(device: unknown): IRawDiscovery {
  const xaddr = firstXAddr(device);
  if (!xaddr) {
    return { xaddr: undefined, hostname: undefined, port: undefined };
  }
  let hostname: string | undefined;
  let port: number | undefined;
  try {
    const parsed = new URL(xaddr);
    hostname = parsed.hostname || undefined;
    port = parsed.port ? Number(parsed.port) : undefined;
  } catch {
    /* keep host/port undefined; the xaddr still surfaces for the SSRF-guarded introspect step */
  }
  return { xaddr, hostname, port: Number.isFinite(port) ? port : undefined };
}

/** The first advertised XAddr URI from a raw ProbeMatch (XAddrs is a space-separated string). */
function firstXAddr(device: unknown): string | undefined {
  const matches = (device as { probeMatches?: { probeMatch?: unknown } })?.probeMatches?.probeMatch;
  const match = Array.isArray(matches) ? matches[0] : matches;
  const xaddrs = (match as { XAddrs?: unknown } | null)?.XAddrs;
  if (typeof xaddrs !== 'string') {
    return undefined;
  }
  return xaddrs.split(/\s+/).filter(Boolean)[0];
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
      const finish = (devices: unknown[]): void => {
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
        // resolve:false -> the library returns raw ProbeMatch data and never connects to the device.
        probe({ timeout: timeoutMs, resolve: false }, (err, devices) => {
          finish(err || !Array.isArray(devices) ? [] : devices);
        });
      } catch {
        finish([]);
      }
    });
}
