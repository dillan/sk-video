import makeMdns from 'multicast-dns';
import type { DiscoveryProbe } from './discovery-service';
import { sanitizeDeviceString, type IRawDiscovery } from './normalize';

/** Hard cap on records buffered during one scan, so a flooding device can't exhaust memory. */
const MAX_MDNS_RECORDS = 2000;

/** mDNS service types that streaming cameras commonly advertise. */
export const CAMERA_SERVICES = ['_rtsp._tcp', '_rtsps._tcp', '_onvif._tcp', '_axis-video._tcp'];

/** A minimal view of a dns-packet answer record (A/AAAA/SRV are all we read). */
export interface IMdnsRecord {
  name: string;
  type: string;
  data: unknown;
}

/**
 * Turns mDNS answer records into raw discovery hits: SRV records advertised under a camera service
 * give the host/port and a friendly instance name; A/AAAA records resolve the SRV target to an IP.
 * Pure and testable.
 */
export function parseMdnsRecords(records: IMdnsRecord[]): IRawDiscovery[] {
  const ips = new Map<string, string>();
  for (const r of records) {
    if ((r.type === 'A' || r.type === 'AAAA') && typeof r.data === 'string') {
      ips.set(r.name.toLowerCase(), r.data);
    }
  }

  const out: IRawDiscovery[] = [];
  for (const r of records) {
    if (r.type !== 'SRV') {
      continue;
    }
    const service = CAMERA_SERVICES.find((s) => r.name.includes(s));
    if (!service) {
      continue;
    }
    const data = r.data as { target?: string; port?: number };
    if (!data?.target) {
      continue;
    }
    const hostname = ips.get(data.target.toLowerCase()) ?? data.target;
    const label = sanitizeDeviceString(r.name.split(`.${service}`)[0] || data.target);
    out.push({
      hostname,
      port: typeof data.port === 'number' ? data.port : undefined,
      name: label || undefined,
    });
  }
  return out;
}

/**
 * An mDNS probe that queries the camera service types and collects responses for the scan window.
 * Always resolves (never rejects) so the wider scan tolerates a missing/blocked multicast socket.
 */
export function createMdnsProbe(make: typeof makeMdns = makeMdns): DiscoveryProbe {
  return (timeoutMs: number) =>
    new Promise<IRawDiscovery[]>((resolve) => {
      const records: IMdnsRecord[] = [];
      let mdns: ReturnType<typeof makeMdns>;
      try {
        mdns = make();
      } catch {
        resolve([]);
        return;
      }

      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          mdns.destroy();
        } catch {
          // ignore teardown errors
        }
        resolve(parseMdnsRecords(records));
      };

      mdns.on('error', finish);
      mdns.on('response', (packet) => {
        for (const a of [...(packet.answers ?? []), ...(packet.additionals ?? [])]) {
          if (records.length >= MAX_MDNS_RECORDS) {
            break;
          }
          records.push(a as IMdnsRecord);
        }
      });

      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();

      for (const service of CAMERA_SERVICES) {
        try {
          mdns.query({
            questions: [{ name: `${service}.local`, type: 'PTR' }],
          });
        } catch {
          // ignore per-question send errors; the scan still resolves on timeout
        }
      }
    });
}
