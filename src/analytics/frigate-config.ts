/**
 * Validates the guided Frigate connect settings before anything touches the network. The broker URL
 * must use an MQTT(-over-WS/TLS) scheme MQTT.js understands; the optional clip API URL must be http(s)
 * (its host is SSRF-guarded later, at fetch time). A bad broker URL disables Frigate with a clear
 * reason; a bad API URL only disables clip caching (notifications still work) via a warning. Error and
 * warning strings never echo the raw URL, so credentials in `user:pass@host` can't leak into the log.
 */

const MQTT_SCHEMES = new Set(['mqtt', 'mqtts', 'ws', 'wss', 'tcp', 'tls']);
const API_SCHEMES = new Set(['http', 'https']);

export type TFrigateConfigResult =
  | { ok: true; mqttUrl: string; apiUrl: string | null; warnings: string[] }
  | { ok: false; error: string };

interface IParsedUrl {
  scheme: string;
  host: string;
}

function parseUrl(raw: string): IParsedUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return { scheme: url.protocol.replace(/:$/, ''), host: url.hostname };
}

export function validateFrigateConfig(input: {
  mqttUrl?: string;
  apiUrl?: string;
}): TFrigateConfigResult {
  const mqttUrl = (input.mqttUrl ?? '').trim();
  if (!mqttUrl) {
    return { ok: false, error: 'no Frigate MQTT broker URL configured' };
  }
  const broker = parseUrl(mqttUrl);
  if (!broker || !MQTT_SCHEMES.has(broker.scheme) || !broker.host) {
    return {
      ok: false,
      error: 'Frigate MQTT broker URL must be mqtt://, mqtts://, ws:// or wss:// with a host',
    };
  }

  const warnings: string[] = [];
  const apiRaw = (input.apiUrl ?? '').trim();
  let apiUrl: string | null = null;
  if (apiRaw) {
    const api = parseUrl(apiRaw);
    if (api && API_SCHEMES.has(api.scheme) && api.host) {
      apiUrl = apiRaw;
    } else {
      warnings.push(
        'Frigate API URL must be http:// or https:// — ignoring it; notifications only.',
      );
    }
  }
  return { ok: true, mqttUrl, apiUrl, warnings };
}
