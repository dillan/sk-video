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

/**
 * Per-camera server-evaluated health-alarm thresholds. An entry hands the camera's feed-outage
 * alarm to Signal K's own zones watcher: the plugin publishes zones meta on the gauge and stops
 * raising its own watchdog notification for that camera (single alarm authority).
 */
export interface ICameraHealthZonesConfig {
  /** Seconds of feed outage where the warn zone begins. */
  warnAfterSeconds: number;
  /** Seconds where the alarm zone begins (also the warn zone's exclusive upper bound). */
  alarmAfterSeconds: number;
}

export interface IOperationalConfig {
  hardwareTier?: string;
  autoTriggerPath?: string;
  anchorWatchPath?: string;
  mobVisualRefine?: boolean;
  /**
   * Buffered DVR recording (per-camera Record + incident pre-roll). Default ON; set false to disable
   * recording plugin-wide on a constrained host — the recorders (an ffmpeg remux per camera) stop and
   * POST /record is refused. Recording is a copy, not a transcode, so this is a modest CPU/disk saving.
   */
  recordingEnabled?: boolean;
  /**
   * Opt-in hardware transcoding. Default OFF. When true, an H.265 camera with no H.264 sub-stream
   * gains a GPU-accelerated H.264 transcode source so the browser plays it over WebRTC on the GPU
   * instead of a CPU core. Off by default because go2rtc's own guidance is that hardware transcoding
   * can be unstable and a misdetected engine is worse than software; on a Pi the H.265 decode stays
   * on the CPU (only the H.264 encode is offloaded). A change restarts the gateway.
   */
  hardwareAcceleration?: boolean;
  /** Keyed by camera id; presence of an entry = zones enabled for that camera. */
  cameraHealthZones?: Record<string, ICameraHealthZonesConfig>;
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
  'recordingEnabled',
  'hardwareAcceleration',
  'cameraHealthZones',
  'frigate',
]);

// Same slug rule as camera ids: these keys become Signal K meta paths (cameras.<id>.feedOutage),
// so a dotted/path-ish key must never pass through.
const ZONE_CAMERA_ID_RE = /^[A-Za-z0-9-]+$/;
const ZONE_KEYS = new Set(['warnAfterSeconds', 'alarmAfterSeconds']);
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
  if (o.recordingEnabled !== undefined) {
    if (typeof o.recordingEnabled !== 'boolean') errors.push('recordingEnabled must be a boolean');
    else value.recordingEnabled = o.recordingEnabled;
  }
  if (o.hardwareAcceleration !== undefined) {
    if (typeof o.hardwareAcceleration !== 'boolean')
      errors.push('hardwareAcceleration must be a boolean');
    else value.hardwareAcceleration = o.hardwareAcceleration;
  }

  if (o.cameraHealthZones !== undefined) {
    const zonesMap = asObject(o.cameraHealthZones);
    if (!zonesMap) {
      errors.push('cameraHealthZones must be an object keyed by camera id');
    } else {
      const out: Record<string, ICameraHealthZonesConfig> = {};
      for (const [id, raw] of Object.entries(zonesMap)) {
        if (!ZONE_CAMERA_ID_RE.test(id)) {
          errors.push(`cameraHealthZones: "${id}" is not a valid camera id`);
          continue;
        }
        const entry = asObject(raw);
        if (!entry) {
          errors.push(`cameraHealthZones.${id} must be an object`);
          continue;
        }
        for (const k of Object.keys(entry)) {
          if (!ZONE_KEYS.has(k)) errors.push(`unexpected cameraHealthZones.${id} field "${k}"`);
        }
        const warn = Number(entry.warnAfterSeconds);
        const alarm = Number(entry.alarmAfterSeconds);
        if (!Number.isFinite(warn) || warn <= 0) {
          errors.push(`cameraHealthZones.${id}.warnAfterSeconds must be a positive number`);
        } else if (!Number.isFinite(alarm) || alarm <= 0) {
          errors.push(`cameraHealthZones.${id}.alarmAfterSeconds must be a positive number`);
        } else if (warn >= alarm) {
          errors.push(`cameraHealthZones.${id}: warnAfterSeconds must be below alarmAfterSeconds`);
        } else {
          out[id] = { warnAfterSeconds: warn, alarmAfterSeconds: alarm };
        }
      }
      value.cameraHealthZones = out;
    }
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
