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
export function isIpAllowed(ip: string, options: ISsrfOptions): boolean {
  void ip;
  void options;
  // RED stub.
  return false;
}
