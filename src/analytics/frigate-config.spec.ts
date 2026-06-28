import { describe, it, expect } from 'vitest';
import { validateFrigateConfig } from './frigate-config';

describe('validateFrigateConfig', () => {
  it('accepts a well-formed mqtt broker URL and http api URL', () => {
    const result = validateFrigateConfig({
      mqttUrl: 'mqtt://192.168.1.10:1883',
      apiUrl: 'http://192.168.1.10:5000',
    });
    expect(result).toEqual({
      ok: true,
      mqttUrl: 'mqtt://192.168.1.10:1883',
      apiUrl: 'http://192.168.1.10:5000',
      warnings: [],
    });
  });

  it('accepts mqtts/ws/wss broker schemes', () => {
    for (const url of ['mqtts://h:8883', 'ws://h:9001', 'wss://h:9001']) {
      expect(validateFrigateConfig({ mqttUrl: url }).ok).toBe(true);
    }
  });

  it('trims surrounding whitespace before validating', () => {
    const result = validateFrigateConfig({ mqttUrl: '  mqtt://h:1883  ' });
    expect(result).toEqual({ ok: true, mqttUrl: 'mqtt://h:1883', apiUrl: null, warnings: [] });
  });

  it('is disabled (not an error) when no broker URL is set', () => {
    const result = validateFrigateConfig({ mqttUrl: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no Frigate MQTT/i);
    }
  });

  it('rejects a broker URL on a non-mqtt scheme without echoing credentials', () => {
    const result = validateFrigateConfig({ mqttUrl: 'http://user:secret@h:1883' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('secret');
      expect(result.error).toMatch(/mqtt/i);
    }
  });

  it('rejects an unparseable broker URL', () => {
    const result = validateFrigateConfig({ mqttUrl: 'not a url' });
    expect(result.ok).toBe(false);
  });

  it('keeps notifications working but warns when the api URL is not http(s)', () => {
    const result = validateFrigateConfig({
      mqttUrl: 'mqtt://h:1883',
      apiUrl: 'ftp://h/clip',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.apiUrl).toBeNull();
      expect(result.warnings.join(' ')).toMatch(/api URL/i);
    }
  });

  it('does not echo api-url credentials in the warning', () => {
    const result = validateFrigateConfig({
      mqttUrl: 'mqtt://h:1883',
      apiUrl: 'gopher://user:topsecret@h',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.join(' ')).not.toContain('topsecret');
    }
  });
});
