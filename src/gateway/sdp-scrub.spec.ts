import { describe, it, expect } from 'vitest';
import { scrubSdpCandidates, candidateHost, isLocalClientAddress } from './sdp-scrub';

const LINES = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=candidate:1 1 UDP 2130706431 192.168.1.10 8555 typ host',
  'a=candidate:2 1 UDP 2130706430 127.0.0.1 8555 typ host',
  'a=candidate:3 1 UDP 2130706429 ::1 8555 typ host',
  'a=candidate:4 1 UDP 2130706428 169.254.7.9 8555 typ host',
  'a=candidate:5 1 UDP 2130706427 fe80::abcd 8555 typ host',
  'a=candidate:6 1 UDP 1694498815 203.0.113.9 8555 typ srflx raddr 0.0.0.0 rport 0',
  'a=end-of-candidates',
];

describe('scrubSdpCandidates', () => {
  it('drops loopback and link-local host candidates for a remote client', () => {
    const out = scrubSdpCandidates(LINES.join('\r\n'), { clientIsLocal: false });
    expect(out).toContain('192.168.1.10');
    expect(out).not.toContain('127.0.0.1 8555');
    expect(out).not.toContain('::1 8555');
    expect(out).not.toContain('169.254.7.9');
    expect(out).not.toContain('fe80::abcd');
  });

  it('keeps loopback for a local client, but still drops link-local', () => {
    const out = scrubSdpCandidates(LINES.join('\r\n'), { clientIsLocal: true });
    expect(out).toContain('127.0.0.1 8555');
    expect(out).toContain('::1 8555');
    expect(out).not.toContain('169.254.7.9');
  });

  it('never touches non-host candidates or non-candidate lines', () => {
    const out = scrubSdpCandidates(LINES.join('\r\n'), { clientIsLocal: false });
    expect(out).toContain('typ srflx'); // STUN-discovered — client-relevant
    expect(out).toContain('o=- 1 2 IN IP4 127.0.0.1'); // origin line is not a candidate
    expect(out).toContain('a=end-of-candidates');
  });

  it('preserves CRLF line structure', () => {
    const out = scrubSdpCandidates('v=0\r\na=candidate:2 1 UDP 1 127.0.0.1 8555 typ host\r\nm=x', {
      clientIsLocal: false,
    });
    expect(out).toBe('v=0\r\nm=x');
  });

  it('always keeps operator-configured candidates, even loopback for a remote client', () => {
    const out = scrubSdpCandidates(LINES.join('\r\n'), {
      clientIsLocal: false,
      allowHosts: ['127.0.0.1'],
    });
    expect(out).toContain('127.0.0.1 8555');
    expect(out).not.toContain('::1 8555');
  });

  it('passes malformed candidate lines through untouched (fail-open, never break negotiation)', () => {
    const weird = 'a=candidate:garbage';
    expect(scrubSdpCandidates(weird, { clientIsLocal: false })).toBe(weird);
  });
});

describe('candidateHost', () => {
  it('strips the port from ip:port and lowercases', () => {
    expect(candidateHost('127.0.0.1:8555')).toBe('127.0.0.1');
    expect(candidateHost(' 192.168.1.10:9000 ')).toBe('192.168.1.10');
  });

  it('handles bracketed IPv6 and bare IPv6', () => {
    expect(candidateHost('[FE80::1]:8555')).toBe('fe80::1');
    expect(candidateHost('::1')).toBe('::1');
  });

  it('returns a bare host unchanged', () => {
    expect(candidateHost('boat.local')).toBe('boat.local');
  });
});

describe('isLocalClientAddress', () => {
  it('recognises IPv4/IPv6 loopback including the v4-mapped form', () => {
    expect(isLocalClientAddress('127.0.0.1')).toBe(true);
    expect(isLocalClientAddress('::1')).toBe(true);
    expect(isLocalClientAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects LAN and absent addresses', () => {
    expect(isLocalClientAddress('192.168.1.50')).toBe(false);
    expect(isLocalClientAddress(undefined)).toBe(false);
  });
});
