import { describe, it, expect } from 'vitest';
import {
  validateOperationalConfig,
  redactConfig,
  mergeConfig,
  type IOperationalConfig,
} from './operational-config';

describe('validateOperationalConfig', () => {
  it('accepts a full valid config and normalizes it', () => {
    const r = validateOperationalConfig({
      hardwareTier: 'pi4',
      autoTriggerPath: ' notifications.foo ',
      anchorWatchPath: 'notifications.navigation.anchor',
      mobVisualRefine: true,
      frigate: {
        mqttHost: '192.168.1.10',
        mqttPort: 1883,
        mqttTls: false,
        mqttUsername: 'frig',
        mqttPassword: 'secret',
        apiUrl: 'http://192.168.1.10:5000',
        labels: 'person, car',
        minScore: 0.8,
        zones: 'dock',
      },
    });
    expect(r.valid).toBe(true);
    expect(r.value?.autoTriggerPath).toBe('notifications.foo'); // trimmed
    expect(r.value?.frigate?.mqttPort).toBe(1883);
  });

  it('rejects unknown top-level keys and a bad tier', () => {
    expect(validateOperationalConfig({ bogus: 1 }).valid).toBe(false);
    expect(validateOperationalConfig({ hardwareTier: 'supercomputer' }).valid).toBe(false);
  });

  it('clamps frigate minScore into [0,1] and validates the port range', () => {
    expect(validateOperationalConfig({ frigate: { minScore: 5 } }).value?.frigate?.minScore).toBe(
      1,
    );
    expect(validateOperationalConfig({ frigate: { minScore: -1 } }).value?.frigate?.minScore).toBe(
      0,
    );
    expect(validateOperationalConfig({ frigate: { mqttPort: 70000 } }).valid).toBe(false);
  });

  it('rejects a non-http(s) Frigate API URL', () => {
    expect(validateOperationalConfig({ frigate: { apiUrl: 'file:///etc/passwd' } }).valid).toBe(
      false,
    );
  });

  it('keeps mqttPassword absent when the key is omitted (so merge can preserve it)', () => {
    const r = validateOperationalConfig({ frigate: { mqttHost: 'x' } });
    expect(r.valid).toBe(true);
    expect('mqttPassword' in (r.value?.frigate ?? {})).toBe(false);
  });

  it('treats an empty config as valid (everything disabled)', () => {
    expect(validateOperationalConfig({}).valid).toBe(true);
  });
});

describe('redactConfig', () => {
  it('never emits the password — only a presence flag', () => {
    const cfg: IOperationalConfig = { frigate: { mqttHost: 'x', mqttPassword: 'secret' } };
    const pub = redactConfig(cfg);
    expect((pub.frigate as Record<string, unknown>).mqttPassword).toBeUndefined();
    expect(pub.frigate.mqttPasswordSet).toBe(true);
    expect(pub.frigate.mqttHost).toBe('x');
  });

  it('reports mqttPasswordSet false when there is no password', () => {
    expect(redactConfig({ frigate: { mqttHost: 'x' } }).frigate.mqttPasswordSet).toBe(false);
    expect(redactConfig({}).frigate.mqttPasswordSet).toBe(false);
  });
});

describe('validateOperationalConfig — cameraHealthZones (server-evaluated health alarms)', () => {
  it('accepts per-camera thresholds and normalizes the numbers', () => {
    const r = validateOperationalConfig({
      cameraHealthZones: {
        bow: { warnAfterSeconds: 45, alarmAfterSeconds: 120 },
        'engine-bay': { warnAfterSeconds: '60', alarmAfterSeconds: 300 },
      },
    });
    expect(r.valid).toBe(true);
    expect(r.value?.cameraHealthZones).toEqual({
      bow: { warnAfterSeconds: 45, alarmAfterSeconds: 120 },
      'engine-bay': { warnAfterSeconds: 60, alarmAfterSeconds: 300 },
    });
  });

  it('rejects malformed entries', () => {
    // warn must sit strictly below alarm (the warn zone is [warn, alarm) — upper is exclusive)
    expect(
      validateOperationalConfig({
        cameraHealthZones: { bow: { warnAfterSeconds: 120, alarmAfterSeconds: 120 } },
      }).valid,
    ).toBe(false);
    expect(
      validateOperationalConfig({
        cameraHealthZones: { bow: { warnAfterSeconds: -5, alarmAfterSeconds: 120 } },
      }).valid,
    ).toBe(false);
    expect(
      validateOperationalConfig({
        cameraHealthZones: { bow: { warnAfterSeconds: 45 } },
      }).valid,
    ).toBe(false);
    expect(
      validateOperationalConfig({
        cameraHealthZones: { bow: { warnAfterSeconds: 45, alarmAfterSeconds: 120, bogus: 1 } },
      }).valid,
    ).toBe(false);
    expect(validateOperationalConfig({ cameraHealthZones: { bow: 'on' } }).valid).toBe(false);
    expect(validateOperationalConfig({ cameraHealthZones: [] }).valid).toBe(false);
    // camera ids are slugs — a path-ish key must not pass into meta paths
    expect(
      validateOperationalConfig({
        cameraHealthZones: { 'bow.hacked': { warnAfterSeconds: 45, alarmAfterSeconds: 120 } },
      }).valid,
    ).toBe(false);
  });

  it('passes through redact and merge untouched (no secrets involved)', () => {
    const cfg: IOperationalConfig = {
      cameraHealthZones: { bow: { warnAfterSeconds: 45, alarmAfterSeconds: 120 } },
    };
    expect(redactConfig(cfg).cameraHealthZones).toEqual(cfg.cameraHealthZones);
    const merged = mergeConfig(
      { cameraHealthZones: { stern: { warnAfterSeconds: 30, alarmAfterSeconds: 90 } } },
      cfg,
    );
    expect(merged.cameraHealthZones).toEqual(cfg.cameraHealthZones); // update wins wholesale
  });
});

describe('mergeConfig (password preservation)', () => {
  const current: IOperationalConfig = {
    frigate: { mqttHost: 'old', mqttPassword: 'keepme' },
  };

  it('keeps the existing password when the update omits it', () => {
    const merged = mergeConfig(current, { frigate: { mqttHost: 'new' } });
    expect(merged.frigate?.mqttHost).toBe('new');
    expect(merged.frigate?.mqttPassword).toBe('keepme');
  });

  it('replaces the password when the update provides a new one', () => {
    const merged = mergeConfig(current, { frigate: { mqttHost: 'new', mqttPassword: 'fresh' } });
    expect(merged.frigate?.mqttPassword).toBe('fresh');
  });

  it('clears the password when the update sends an empty string', () => {
    const merged = mergeConfig(current, { frigate: { mqttHost: 'new', mqttPassword: '' } });
    expect(merged.frigate?.mqttPassword).toBeUndefined();
  });
});
