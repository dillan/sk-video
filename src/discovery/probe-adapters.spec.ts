import { describe, it, expect } from 'vitest';
import { adaptOnvifDevice } from './ws-discovery-probe';
import { parseMdnsRecords } from './mdns-probe';

describe('adaptOnvifDevice', () => {
  // resolve:false hands us a raw ProbeMatch (XAddrs is a space-separated URI string), not a Cam.
  const rawMatch = (xaddrs: string) => ({ probeMatches: { probeMatch: { XAddrs: xaddrs } } });

  it('parses the XAddr URI into xaddr + hostname + port', () => {
    expect(adaptOnvifDevice(rawMatch('http://192.168.1.60:8080/onvif/device_service'))).toEqual({
      xaddr: 'http://192.168.1.60:8080/onvif/device_service',
      hostname: '192.168.1.60',
      port: 8080,
    });
  });

  it('returns all-undefined for a probe-match with no XAddr', () => {
    expect(adaptOnvifDevice({ probeMatches: { probeMatch: {} } })).toEqual({
      xaddr: undefined,
      hostname: undefined,
      port: undefined,
    });
  });
});

describe('parseMdnsRecords', () => {
  it('builds a candidate from an SRV record under a camera service, resolved to its A-record IP', () => {
    const out = parseMdnsRecords([
      {
        name: 'Front Door._rtsp._tcp.local',
        type: 'SRV',
        data: { target: 'cam-1.local', port: 554 },
      },
      { name: 'cam-1.local', type: 'A', data: '10.0.0.7' },
    ]);
    expect(out).toEqual([{ hostname: '10.0.0.7', port: 554, name: 'Front Door' }]);
  });

  it('falls back to the SRV target when there is no A record', () => {
    const out = parseMdnsRecords([
      {
        name: 'Aft._onvif._tcp.local',
        type: 'SRV',
        data: { target: 'aft.local', port: 80 },
      },
    ]);
    expect(out).toEqual([{ hostname: 'aft.local', port: 80, name: 'Aft' }]);
  });

  it('ignores non-camera services and SRV records without a target', () => {
    expect(
      parseMdnsRecords([
        {
          name: 'printer._ipp._tcp.local',
          type: 'SRV',
          data: { target: 'p.local', port: 631 },
        },
        { name: 'x._rtsp._tcp.local', type: 'SRV', data: {} },
      ]),
    ).toEqual([]);
  });

  it('does not confuse _rtsp with _rtsps', () => {
    const out = parseMdnsRecords([
      {
        name: 'Secure._rtsps._tcp.local',
        type: 'SRV',
        data: { target: 's.local', port: 322 },
      },
    ]);
    expect(out).toEqual([{ hostname: 's.local', port: 322, name: 'Secure' }]);
  });
});
