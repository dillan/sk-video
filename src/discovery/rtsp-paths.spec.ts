import { describe, it, expect } from 'vitest';
import { guessRtspPaths } from './rtsp-paths';

describe('guessRtspPaths', () => {
  it('knows common manufacturers (main + sub paths)', () => {
    expect(guessRtspPaths('Hikvision')).toEqual({
      main: '/Streaming/Channels/101',
      sub: '/Streaming/Channels/102',
    });
    expect(guessRtspPaths('Dahua Technology')).toMatchObject({
      main: '/cam/realmonitor?channel=1&subtype=0',
    });
    expect(guessRtspPaths('Reolink RLC-810A')).toMatchObject({ main: '/h264Preview_01_main' });
  });

  it('matches case-insensitively and within a longer model string', () => {
    expect(guessRtspPaths('AXIS M3045-V')).toMatchObject({ main: '/axis-media/media.amp' });
  });

  it('returns null for an unknown manufacturer', () => {
    expect(guessRtspPaths('NoNameCam 9000')).toBeNull();
    expect(guessRtspPaths('')).toBeNull();
  });
});
