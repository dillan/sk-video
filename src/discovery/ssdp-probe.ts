import type { DiscoveryProbe } from './discovery-service';
import type { IRawDiscovery } from './normalize';

/**
 * An SSDP/UPnP discovery probe: it M-SEARCHes the LAN and keeps only camera-like devices (SSDP is
 * noisy — routers, TVs, printers all answer), so cameras that don't speak WS-Discovery or advertise
 * an ONVIF mDNS service still surface. The wire parsing is a pure, well-tested function; the socket
 * IO is a thin wrapper with an injectable factory that always resolves (a blocked multicast socket
 * just yields no hits, never a rejected scan).
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

/** The minimal UDP socket surface the probe drives (so tests can inject a fake). */
export interface ISsdpSocket {
  on(event: 'message', listener: (msg: Buffer) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  send(msg: Buffer, port: number, address: string): void;
  close(): void;
}

export type MakeSsdpSocket = () => ISsdpSocket;

/** Parses raw SSDP response datagrams into camera-like discovery hits (deduped by host). */
export function parseSsdpResponses(_responses: string[]): IRawDiscovery[] {
  return [];
}

export function createSsdpProbe(_makeSocket?: MakeSsdpSocket): DiscoveryProbe {
  return () => Promise.resolve([]);
}
