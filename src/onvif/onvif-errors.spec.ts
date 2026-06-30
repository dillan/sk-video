import { describe, it, expect } from 'vitest';
import { categorizeOnvifError } from './onvif-errors';

describe('categorizeOnvifError', () => {
  it('flags an unreachable camera (DNS/connection/timeout)', () => {
    expect(categorizeOnvifError(new Error('connect ECONNREFUSED 192.168.1.100:80')).reason).toBe(
      'unreachable',
    );
    expect(categorizeOnvifError(new Error('getaddrinfo ENOTFOUND cam.local')).reason).toBe(
      'unreachable',
    );
    expect(categorizeOnvifError(new Error('ONVIF request timed out')).reason).toBe('unreachable');
  });

  it('flags an auth rejection', () => {
    expect(categorizeOnvifError(new Error('Sender not authorized')).reason).toBe('auth');
    expect(categorizeOnvifError(new Error('HTTP 401 Unauthorized')).reason).toBe('auth');
  });

  it('flags a wrong-service / disabled-ONVIF response (the Reolink-on-:80 case)', () => {
    const f = categorizeOnvifError(new Error('Wrong ONVIF SOAP response'));
    expect(f.reason).toBe('onvif');
    expect(f.hint).toMatch(/ONVIF/);
  });

  it('falls back to unknown with a generic but honest hint', () => {
    const f = categorizeOnvifError(new Error('something odd'));
    expect(f.reason).toBe('unknown');
    expect(f.hint).toBeTruthy();
  });
});
