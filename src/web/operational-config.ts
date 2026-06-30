import { TIER_ORDER } from '../hardware/tier-detect';

/**
 * The plugin's operational configuration, owned by the SK Video web app (not the Signal K admin form).
 * Persisted as the plugin's options via the server's restart() contract, read back in start(). Frigate
 * MQTT credentials are structured (host/port/user/password) rather than a URL with embedded secrets,
 * so the write-only password can be redacted on read — mirroring the camera-credential model.
 */
export interface IFrigateOperationalConfig {
  mqttHost?: string;
  mqttPort?: number;
  mqttTls?: boolean;
  mqttUsername?: string;
  /** Write-only: accepted on PUT, never returned on GET. */
  mqttPassword?: string;
  apiUrl?: string;
  /** Comma-separated object labels that count as an intrusion. */
  labels?: string;
  /** Minimum detection score 0–1. */
  minScore?: number;
  /** Comma-separated Frigate zones; blank = any. */
  zones?: string;
}

export interface IOperationalConfig {
  hardwareTier?: string;
  autoTriggerPath?: string;
  anchorWatchPath?: string;
  mobVisualRefine?: boolean;
  frigate?: IFrigateOperationalConfig;
}

/** The Frigate config as sent to the client: password replaced by a presence flag. */
export type IPublicFrigateConfig = Omit<IFrigateOperationalConfig, 'mqttPassword'> & {
  mqttPasswordSet: boolean;
};
export type IPublicOperationalConfig = Omit<IOperationalConfig, 'frigate'> & {
  frigate: IPublicFrigateConfig;
};

export interface IValidation<T> {
  valid: boolean;
  errors: string[];
  value?: T;
}

const TOP_KEYS = new Set([
  'hardwareTier',
  'autoTriggerPath',
  'anchorWatchPath',
  'mobVisualRefine',
  'frigate',
]);
const FRIGATE_KEYS = new Set([
  'mqttHost',
  'mqttPort',
  'mqttTls',
  'mqttUsername',
  'mqttPassword',
  'apiUrl',
  'labels',
  'minScore',
  'zones',
]);

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Validate + normalize an untrusted operational-config body (e.g. from PUT /config). */
export function validateOperationalConfig(input: unknown): IValidation<IOperationalConfig> {
  const o = input === undefined ? {} : asObject(input);
  if (!o) return { valid: false, errors: ['config must be an object'] };
  const errors: string[] = [];
  for (const k of Object.keys(o)) if (!TOP_KEYS.has(k)) errors.push(`unexpected field "${k}"`);

  const value: IOperationalConfig = {};

  if (o.hardwareTier !== undefined) {
    const tier = String(o.hardwareTier);
    if (tier !== 'auto' && !TIER_ORDER.includes(tier as (typeof TIER_ORDER)[number])) {
      errors.push('hardwareTier must be "auto" or a known tier');
    } else {
      value.hardwareTier = tier;
    }
  }
  const str = (v: unknown, name: string): string | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== 'string') {
      errors.push(`${name} must be a string`);
      return undefined;
    }
    return v.trim();
  };
  const atp = str(o.autoTriggerPath, 'autoTriggerPath');
  if (atp !== undefined) value.autoTriggerPath = atp;
  const awp = str(o.anchorWatchPath, 'anchorWatchPath');
  if (awp !== undefined) value.anchorWatchPath = awp;
  if (o.mobVisualRefine !== undefined) {
    if (typeof o.mobVisualRefine !== 'boolean') errors.push('mobVisualRefine must be a boolean');
    else value.mobVisualRefine = o.mobVisualRefine;
  }

  if (o.frigate !== undefined) {
    const f = asObject(o.frigate);
    if (!f) {
      errors.push('frigate must be an object');
    } else {
      for (const k of Object.keys(f))
        if (!FRIGATE_KEYS.has(k)) errors.push(`unexpected frigate field "${k}"`);
      const fr: IFrigateOperationalConfig = {};
      const fstr = (v: unknown, name: string): string | undefined => {
        if (v === undefined) return undefined;
        if (typeof v !== 'string') {
          errors.push(`frigate.${name} must be a string`);
          return undefined;
        }
        return v.trim();
      };
      const host = fstr(f.mqttHost, 'mqttHost');
      if (host !== undefined) fr.mqttHost = host;
      const user = fstr(f.mqttUsername, 'mqttUsername');
      if (user !== undefined) fr.mqttUsername = user;
      // Password: preserve presence (even empty, which means "clear") so merge can tell keep vs clear.
      if ('mqttPassword' in f) {
        if (typeof f.mqttPassword !== 'string')
          errors.push('frigate.mqttPassword must be a string');
        else fr.mqttPassword = f.mqttPassword;
      }
      const labels = fstr(f.labels, 'labels');
      if (labels !== undefined) fr.labels = labels;
      const zones = fstr(f.zones, 'zones');
      if (zones !== undefined) fr.zones = zones;
      const apiUrl = fstr(f.apiUrl, 'apiUrl');
      if (apiUrl !== undefined) {
        if (apiUrl !== '' && !/^https?:\/\//i.test(apiUrl)) {
          errors.push('frigate.apiUrl must be an http(s) URL');
        } else {
          fr.apiUrl = apiUrl;
        }
      }
      if (f.mqttTls !== undefined) {
        if (typeof f.mqttTls !== 'boolean') errors.push('frigate.mqttTls must be a boolean');
        else fr.mqttTls = f.mqttTls;
      }
      if (f.mqttPort !== undefined) {
        const p = Number(f.mqttPort);
        if (!Number.isInteger(p) || p < 1 || p > 65535)
          errors.push('frigate.mqttPort must be 1–65535');
        else fr.mqttPort = p;
      }
      if (f.minScore !== undefined) {
        const s = Number(f.minScore);
        if (!Number.isFinite(s)) errors.push('frigate.minScore must be a number');
        else fr.minScore = Math.min(1, Math.max(0, s));
      }
      value.frigate = fr;
    }
  }

  if (errors.length) return { valid: false, errors };
  return { valid: true, errors: [], value };
}

/** Strip the write-only password, exposing only whether one is set. Safe to send to the client. */
export function redactConfig(cfg: IOperationalConfig): IPublicOperationalConfig {
  const f = cfg.frigate ?? {};
  const { mqttPassword, ...rest } = f;
  return {
    ...cfg,
    frigate: {
      ...rest,
      mqttPasswordSet: typeof mqttPassword === 'string' && mqttPassword.length > 0,
    },
  };
}

/**
 * Merge a validated update onto the current config, resolving the write-only password: a provided
 * non-empty value replaces it, an empty string clears it, and an omitted field keeps the existing one.
 * Non-secret fields are taken wholesale from the update (the client always sends the full config).
 */
export function mergeConfig(
  current: IOperationalConfig,
  update: IOperationalConfig,
): IOperationalConfig {
  const result: IOperationalConfig = { ...update };
  const f = update.frigate;
  if (f || current.frigate) {
    const fIn = f ?? {};
    const resolvedPw =
      'mqttPassword' in fIn ? fIn.mqttPassword || undefined : current.frigate?.mqttPassword;
    const merged: IFrigateOperationalConfig = { ...fIn };
    if (resolvedPw !== undefined) merged.mqttPassword = resolvedPw;
    else delete merged.mqttPassword;
    result.frigate = merged;
  }
  return result;
}
