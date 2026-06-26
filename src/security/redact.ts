/**
 * Removes credentials (the `user:pass@` userinfo) from a URL so it is safe to log. Non-URL strings
 * and URLs without credentials are returned unchanged.
 */
const USERINFO_RE = /^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i;

export function redactUrl(input: string): string {
  return input.replace(USERINFO_RE, '$1***@');
}
