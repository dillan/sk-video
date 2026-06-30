export interface ISsrfOptions {
  /**
   * Allow private LAN ranges (RFC1918 / unique-local). IP cameras live on the LAN, so reaching them
   * requires this to be opted in by the operator. Loopback, link-local and the cloud-metadata
   * address are ALWAYS denied regardless of this flag.
   */
  allowPrivate: boolean;
}

/**
 * Decides whether an already-resolved IP literal is safe for the server to connect to, as the core
 * of the SSRF guard. Never allows loopback, link-local (incl. the 169.254.169.254 metadata address)
 * or the unspecified address; allows RFC1918 / unique-local only when `allowPrivate` is set;
 * otherwise allows public addresses. Invalid input is denied.
 */
import { BlockList, isIP } from 'node:net';

const DENY = new BlockList();
DENY.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
DENY.addAddress('::1', 'ipv6'); // loopback
DENY.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local + cloud metadata (169.254.169.254)
DENY.addSubnet('fe80::', 10, 'ipv6'); // link-local
DENY.addAddress('0.0.0.0', 'ipv4'); // unspecified
DENY.addAddress('::', 'ipv6'); // unspecified

// IPv4-embedding IPv6 forms can smuggle a denied IPv4 (e.g. ::ffff:127.0.0.1 or 64:ff9b::7f00:1 ==
// loopback) past the ipv4 rules above, which only match the ipv4 family. These transition mechanisms
// are not used by a normal camera LAN, so deny the ranges outright. Kept in a SEPARATE list checked
// only for IPv6 inputs: an IPv4-mapped subnet in the main DENY would make Node's BlockList match every
// ipv4 address too (its IPv4-mapped handling), denying the whole internet.
const EMBEDDED_IPV6 = new BlockList();
EMBEDDED_IPV6.addSubnet('::ffff:0:0', 96, 'ipv6'); // IPv4-mapped
EMBEDDED_IPV6.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64 well-known prefix
EMBEDDED_IPV6.addSubnet('64:ff9b:1::', 48, 'ipv6'); // NAT64 local-use prefix
EMBEDDED_IPV6.addSubnet('2002::', 16, 'ipv6'); // 6to4
EMBEDDED_IPV6.addSubnet('2001::', 32, 'ipv6'); // Teredo

const PRIVATE = new BlockList();
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('fc00::', 7, 'ipv6'); // unique-local

export function isIpAllowed(ip: string, options: ISsrfOptions): boolean {
  const family = isIP(ip);
  if (family === 0) {
    return false; // not a valid IP literal
  }
  const kind = family === 4 ? 'ipv4' : 'ipv6';
  if (family === 6 && EMBEDDED_IPV6.check(ip, 'ipv6')) {
    return false; // IPv4-mapped / NAT64 / 6to4 / Teredo — denied outright (checked only for ipv6)
  }
  if (DENY.check(ip, kind)) {
    return false;
  }
  if (PRIVATE.check(ip, kind)) {
    return options.allowPrivate;
  }
  return true;
}

/** Resolves a hostname to its IP addresses. */
export type HostLookup = (host: string) => Promise<string[]>;

/**
 * Asserts that a camera host is safe to connect to. An IP literal is checked directly; a hostname is
 * resolved and EVERY resolved address must be allowed — so a name that resolves (now or via
 * rebinding) to a blocked address is rejected. Throws on a blocked or unresolvable host.
 */
export async function assertHostAllowed(
  host: string,
  options: ISsrfOptions,
  lookup: HostLookup,
): Promise<void> {
  if (isIP(host) !== 0) {
    if (!isIpAllowed(host, options)) {
      throw new Error(`host ${host} is not an allowed address`);
    }
    return;
  }
  const addresses = await lookup(host);
  if (addresses.length === 0) {
    throw new Error(`could not resolve host ${host}`);
  }
  for (const ip of addresses) {
    if (!isIpAllowed(ip, options)) {
      throw new Error(`host ${host} resolves to a blocked address`);
    }
  }
}
