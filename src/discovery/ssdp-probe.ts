import { createSocket } from 'node:dgram';
import type { DiscoveryProbe } from './discovery-service';
import type { IRawDiscovery } from './normalize';

/**
 * An SSDP/UPnP discovery probe: it M-SEARCHes the LAN and keeps only camera-like devices (SSDP is
 * noisy — routers, TVs, printers all answer), so cameras that don't speak WS-Discovery or advertise
 * an ONVIF mDNS service still surface. The wire parsing is a pure, well-tested function; the socket
 * IO is a thin wrapper with an injectable factory that always resolves (a blocked multicast socket
 * just yields no hits, never a rejected scan).
 */

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
/** Hard cap on datagrams buffered during one scan, so a flooding device can't exhaust memory. */
const MAX_SSDP_RESPONSES = 1000;

const MSEARCH = [
  'M-SEARCH * HTTP/1.1',
  `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  'MX: 2',
  'ST: ssdp:all',
  '',
  '',
].join('\r\n');

// Only surface devices whose SSDP fields look like a camera/NVR — SSDP itself is full of non-cameras.
const CAMERA_HINT =
  /camera|ipcam|ip[- ]?cam|onvif|network[\s-]?video|webcam|\bnvr\b|hikvision|dahua|\baxis\b|reolink|amcrest|foscam|vivotek|hanwha|wisenet|tapo/i;

/** The minimal UDP socket surface the probe drives (so tests can inject a fake). */
export interface ISsdpSocket {
  on(event: 'message', listener: (msg: Buffer) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  send(msg: Buffer, port: number, address: string): void;
  close(): void;
}

export type MakeSsdpSocket = () => ISsdpSocket;

/** Parses raw SSDP response datagrams into camera-like discovery hits (deduped by host). */
export function parseSsdpResponses(responses: string[]): IRawDiscovery[] {
  const seen = new Set<string>();
  const out: IRawDiscovery[] = [];
  for (const raw of responses) {
    const headers = parseSsdpHeaders(raw);
    if (!headers.location) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(headers.location);
    } catch {
      continue;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      continue;
    }
    const fingerprint = [headers.st, headers.nt, headers.server, headers.usn]
      .filter(Boolean)
      .join(' ');
    if (!CAMERA_HINT.test(fingerprint)) {
      continue;
    }
    const key = url.hostname.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ hostname: url.hostname });
  }
  return out;
}

/** Parses the HTTP-like SSDP datagram into a lowercased header map (first value per key wins). */
function parseSsdpHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    if (key && !(key in headers)) {
      headers[key] = line.slice(idx + 1).trim();
    }
  }
  return headers;
}

function defaultSocket(): ISsdpSocket {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  return {
    on: ((event: string, listener: (...args: unknown[]) => void) =>
      socket.on(event, listener as never)) as ISsdpSocket['on'],
    send: (msg, port, address) => {
      socket.send(msg, port, address);
    },
    close: () => socket.close(),
  };
}

export function createSsdpProbe(makeSocket: MakeSsdpSocket = defaultSocket): DiscoveryProbe {
  return (timeoutMs: number) =>
    new Promise<IRawDiscovery[]>((resolve) => {
      const responses: string[] = [];
      let socket: ISsdpSocket;
      try {
        socket = makeSocket();
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
          socket.close();
        } catch {
          // ignore teardown errors
        }
        resolve(parseSsdpResponses(responses));
      };

      socket.on('error', finish);
      socket.on('message', (msg) => {
        if (responses.length < MAX_SSDP_RESPONSES) {
          responses.push(msg.toString('utf8'));
        }
      });

      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();

      try {
        socket.send(Buffer.from(MSEARCH), SSDP_PORT, SSDP_ADDR);
      } catch {
        // ignore send errors; the scan still resolves on timeout
      }
    });
}
