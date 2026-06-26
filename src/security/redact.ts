/**
 * Removes credentials (the `user:pass@` userinfo) from any URL embedded in a string so it is safe to
 * log. Works anywhere in the string and on every occurrence — log lines are prefixed (e.g.
 * "go2rtc: ...") before they reach here, so an anchored pattern would never fire. Non-URL strings and
 * URLs without credentials are returned unchanged.
 */
const USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;

export function redactUrl(input: string): string {
  return input.replace(USERINFO_RE, '$1***@');
}
