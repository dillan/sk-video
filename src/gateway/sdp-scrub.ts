/**
 * ICE-candidate scrubbing for the same-origin WHEP/talk proxy.
 *
 * go2rtc binds its WebRTC listener on every interface, so its SDP answer advertises a host
 * candidate per interface: loopback, docker bridges, VPNs — addresses a remote browser can never
 * reach. Relaying them verbatim leaks host topology and slows ICE. The proxy filters host
 * candidates before the answer reaches the browser:
 *
 *  - link-local candidates (169.254/16, fe80::/10) are always dropped — never routable off-host;
 *  - loopback candidates survive only when the client itself connected over loopback
 *    (dev on the same box, the e2e harness's published-port path);
 *  - operator-configured explicit candidates (SKVIDEO_GO2RTC_CANDIDATES) always survive — the
 *    operator asserted they are reachable;
 *  - everything else (LAN addresses, srflx/relay candidates) passes through, because the proxy
 *    cannot know the client's routing table and a wrongly-dropped candidate breaks WebRTC outright.
 */

export interface ISdpScrubOptions {
  /** The requesting client connected over loopback, so loopback candidates are meaningful to it. */
  clientIsLocal: boolean;
  /** Hosts that must always survive (operator-configured explicit candidates). */
  allowHosts?: readonly string[];
}

const isLoopback = (addr: string): boolean =>
  addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');

const isLinkLocal = (addr: string): boolean =>
  addr.startsWith('169.254.') || addr.startsWith('fe80:');

/** Extracts the host part of an `ip:port` / `[v6]:port` candidate config entry. */
export function candidateHost(entry: string): string {
  const trimmed = entry.trim();
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    return close > 0 ? trimmed.slice(1, close).toLowerCase() : trimmed.toLowerCase();
  }
  const colon = trimmed.indexOf(':');
  // A bare IPv6 (multiple colons) has no port suffix to strip.
  return (
    colon > 0 && trimmed.indexOf(':', colon + 1) === -1 ? trimmed.slice(0, colon) : trimmed
  ).toLowerCase();
}

/** Whether a client socket address (as express reports it) is loopback. */
export function isLocalClientAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false;
  }
  return isLoopback(remoteAddress.toLowerCase());
}

/** Filters `a=candidate` lines out of an SDP per the rules above; all other lines pass untouched. */
export function scrubSdpCandidates(sdp: string, opts: ISdpScrubOptions): string {
  const allow = new Set((opts.allowHosts ?? []).map((h) => h.toLowerCase()));
  return sdp
    .split('\n')
    .filter((raw) => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!line.startsWith('a=candidate:')) {
        return true;
      }
      const tokens = line.split(/\s+/);
      const addr = (tokens[4] ?? '').toLowerCase();
      const typIdx = tokens.indexOf('typ');
      const kind = typIdx >= 0 ? (tokens[typIdx + 1] ?? '') : '';
      if (kind !== 'host') {
        return true; // srflx/relay come from STUN/TURN and are client-relevant
      }
      if (allow.has(addr)) {
        return true;
      }
      if (isLinkLocal(addr)) {
        return false;
      }
      if (isLoopback(addr)) {
        return opts.clientIsLocal;
      }
      return true;
    })
    .join('\n');
}
