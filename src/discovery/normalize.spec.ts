import { describe, it, expect } from 'vitest';
import { normalizeDiscovery, sanitizeDeviceString } from './normalize';

describe('sanitizeDeviceString', () => {
  it('strips control characters, collapses whitespace and trims', () => {
    expect(sanitizeDeviceString('  Front\x00 Door\t\n ')).toBe('Front Door');
  });
  it('caps the length', () => {
    expect(sanitizeDeviceString('x'.repeat(200)).length).toBe(64);
  });
});

describe('normalizeDiscovery', () => {
  it('parses host and port from an ONVIF xaddr and names from scopes', () => {
    const c = normalizeDiscovery({
      xaddr: 'http://192.168.1.60:8000/onvif/device_service',
      scopes: ['onvif://www.onvif.org/name/Front%20Door', 'onvif://www.onvif.org/hardware/IPC'],
    });
    expect(c).toEqual({
      name: 'Front Door',
      host: '192.168.1.60',
      port: 8000,
      onvifUrl: 'http://192.168.1.60:8000/onvif/device_service',
    });
  });

  it('uses hostname/port when there is no xaddr', () => {
    const c = normalizeDiscovery({
      hostname: 'cam.local',
      port: 80,
      name: 'Aft Cam',
    });
    expect(c).toEqual({ name: 'Aft Cam', host: 'cam.local', port: 80 });
  });

  it('falls back to the host as the name when none is given', () => {
    expect(normalizeDiscovery({ hostname: '10.0.0.5' })?.name).toBe('10.0.0.5');
  });

  it('sanitizes a hostile name', () => {
    const c = normalizeDiscovery({ hostname: 'h', name: 'Cam\x07\x00 <evil>' });
    expect(c?.name).toBe('Cam <evil>'); // control chars gone; printable text kept (clients escape it)
  });

  it('returns null when there is no usable address', () => {
    expect(normalizeDiscovery({ name: 'nameless' })).toBeNull();
    expect(normalizeDiscovery({ xaddr: 'not a url' })).toBeNull();
  });

  it('rejects a hostile non-http xaddr scheme', () => {
    expect(normalizeDiscovery({ xaddr: 'javascript:alert(1)' })).toBeNull();
    expect(normalizeDiscovery({ xaddr: 'file:///etc/passwd' })).toBeNull();
  });
});
