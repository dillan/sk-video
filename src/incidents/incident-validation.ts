import type { ISnapshotTelemetry } from '../recording/snapshot-service';

/**
 * Pure types + closed-key-set validators for the two untrusted inputs to the incident subsystem:
 * the trigger request body and the operator's bundle patch. Mirrors camera-validation.ts — rejecting
 * unknown keys is the security control that refuses embedded credentials / bytes / paths. Every field
 * is optional, so a bare `{}` "mark incident" is valid. The on-disk id guard lives here too.
 */

export const INCIDENT_STATUSES = ['capturing', 'complete', 'partial', 'failed'] as const;
export type TIncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_ASSET_KINDS = ['clip', 'snapshot', 'telemetry'] as const;
export type TIncidentAssetKind = (typeof INCIDENT_ASSET_KINDS)[number];

export const INCIDENT_TRIGGER_SOURCES = ['manual', 'signalk'] as const;
export type TIncidentTriggerSource = (typeof INCIDENT_TRIGGER_SOURCES)[number];

/** Hard ceiling on each roll so a buffered clip can't blow up RAM on a Pi. */
export const MAX_PRE_MS = 120_000;
export const MAX_POST_MS = 120_000;
const MAX_NOTE_LEN = 2000;
const MAX_LABEL_LEN = 120;

/** Honest coverage record for a clip: what was asked for vs what the DVR segments actually held. */
export interface IClipCoverage {
  requestedStartMs: number;
  requestedEndMs: number;
  actualStartMs: number;
  actualEndMs: number;
  segmentCount: number;
  /** -c copy can only cut on keyframes, so edges are ±one GOP. Always true; stated, not implied. */
  keyframeAligned: true;
  /** False when the cut spans a recorder-restart gap — the clip jumps across missing footage. */
  contiguous: boolean;
}

export interface IIncidentAsset {
  id: string;
  kind: TIncidentAssetKind;
  /** The camera this asset belongs to, or null for the single telemetry track. */
  cameraId: string | null;
  contentType: string;
  size: number;
  sha256: string;
  /** Sanitized display name (Content-Disposition only) — never the on-disk filename. */
  name: string;
  createdAt: number;
  coverage?: IClipCoverage;
}

export interface IIncidentTrigger {
  source: TIncidentTriggerSource;
  firedAt: number;
  /** The notifications.* path that fired (signalk only), redacted. */
  path?: string;
  /** The alarm state that fired (signalk only). */
  state?: string;
  /** A sanitized operator note or the firing notification's message. */
  reason?: string;
}

export interface IIncidentFailure {
  kind: TIncidentAssetKind;
  cameraId: string | null;
  reason: string;
}

export interface IIncidentTelemetrySummary {
  sampleCount: number;
  positionAvailable: boolean;
  oldestReadingAgeMs: number | null;
  /** The bridge is poll-only, so the track is forward-only from T0 — never covers pre-roll. */
  coversPreRoll: false;
  gaps: boolean;
  sampleIntervalMs: number;
}

/** The incident bundle manifest — also the JSON served as the `incidents` Signal K resource. */
export interface IIncidentBundle {
  id: string;
  schemaVersion: 1;
  createdAt: number;
  finalizedAt: number;
  status: TIncidentStatus;
  /** Constant honesty marker on every bundle. */
  evidence: 'best-effort';
  trigger: IIncidentTrigger;
  window: { preMs: number; postMs: number };
  cameras: string[];
  telemetryAtTrigger: ISnapshotTelemetry;
  telemetry: IIncidentTelemetrySummary;
  assets: IIncidentAsset[];
  failures: IIncidentFailure[];
  digest: { algo: 'sha256'; value: string };
  /** Operator-editable, the only client-writable fields. */
  label?: string;
  notes?: string;
  pinned?: boolean;
}

export interface ITriggerRequest {
  cameras?: string[];
  /** Omitted means "use the configured default" — the controller applies it, so don't force 0 here. */
  preMs?: number;
  postMs?: number;
  note?: string;
  /**
   * Epoch-ms anchor for a RETROSPECTIVE mark (cut the clip from the rolling buffer around a past
   * moment, e.g. a scrubbed DVR point). Omitted means "now" — a live mark. The controller caps it at
   * the current time and honestly clamps coverage to whatever segments still exist.
   */
  triggerAt?: number;
}

export interface IIncidentPatch {
  label?: string;
  notes?: string;
  pinned?: boolean;
}

export interface IValidation<T> {
  valid: boolean;
  errors: string[];
  value?: T;
}

/** Incident + asset ids must be a plain safe slug (uuid form qualifies) — used as on-disk names. */
export function isValidIncidentId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(`unexpected ${label} field "${key}"`);
    }
  }
}

/**
 * Strips control characters and length-caps free text (display only, never a path/id). Used for the
 * manual note AND for the untrusted fields the Signal K auto-trigger carries (notification message,
 * path, state), so both trigger paths are bounded identically.
 */
export function sanitizeText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const stripped = Array.from(value)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, maxLen);
  return stripped || undefined;
}

function sanitizeNote(value: unknown): string | undefined {
  return sanitizeText(value, MAX_NOTE_LEN);
}

const TRIGGER_KEYS = new Set(['cameras', 'preMs', 'postMs', 'note', 'triggerAt']);
const PATCH_KEYS = new Set(['label', 'notes', 'pinned']);

/**
 * Validates a trigger request. All fields optional (a bare `{}` mark is valid). Cameras must be safe
 * slugs; preMs/postMs are clamped to [0, MAX]; the note is stripped + length-capped.
 */
export function validateTriggerRequest(input: unknown): IValidation<ITriggerRequest> {
  const o = input === undefined ? {} : asObject(input);
  if (!o) {
    return { valid: false, errors: ['trigger must be an object'] };
  }
  const errors: string[] = [];
  rejectUnknownKeys(o, TRIGGER_KEYS, 'trigger', errors);

  let cameras: string[] | undefined;
  if (o.cameras !== undefined) {
    if (Array.isArray(o.cameras) && o.cameras.every((c) => typeof c === 'string')) {
      const bad = (o.cameras as string[]).filter((c) => !isValidIncidentId(c));
      if (bad.length) {
        errors.push('cameras must be valid ids');
      } else {
        cameras = o.cameras as string[];
      }
    } else {
      errors.push('cameras must be a list of ids');
    }
  }

  // Return undefined for an omitted roll so the controller's configured default survives (a forced 0
  // would shadow it and cut a zero-length clip).
  const clampRoll = (value: unknown, name: string, max: number): number | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${name} must be a number`);
      return undefined;
    }
    return Math.min(Math.max(value, 0), max);
  };
  const preMs = clampRoll(o.preMs, 'preMs', MAX_PRE_MS);
  const postMs = clampRoll(o.postMs, 'postMs', MAX_POST_MS);
  const note = sanitizeNote(o.note);

  let triggerAt: number | undefined;
  if (o.triggerAt !== undefined) {
    if (typeof o.triggerAt !== 'number' || !Number.isFinite(o.triggerAt) || o.triggerAt < 0) {
      errors.push('triggerAt must be a non-negative epoch-ms number');
    } else {
      triggerAt = o.triggerAt;
    }
  }

  if (errors.length) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    errors: [],
    value: {
      ...(cameras ? { cameras } : {}),
      ...(preMs !== undefined ? { preMs } : {}),
      ...(postMs !== undefined ? { postMs } : {}),
      ...(note ? { note } : {}),
      ...(triggerAt !== undefined ? { triggerAt } : {}),
    },
  };
}

/** Validates the operator's editable patch: closed key set, all optional, bounded. */
export function validateIncidentPatch(input: unknown): IValidation<IIncidentPatch> {
  const o = asObject(input);
  if (!o) {
    return { valid: false, errors: ['patch must be an object'] };
  }
  const errors: string[] = [];
  rejectUnknownKeys(o, PATCH_KEYS, 'patch', errors);
  const out: IIncidentPatch = {};

  if (o.label !== undefined) {
    if (typeof o.label === 'string' && o.label.length <= MAX_LABEL_LEN) {
      out.label = o.label;
    } else {
      errors.push('label must be a string up to 120 chars');
    }
  }
  if (o.notes !== undefined) {
    if (typeof o.notes === 'string' && o.notes.length <= MAX_NOTE_LEN) {
      out.notes = o.notes;
    } else {
      errors.push('notes must be a string up to 2000 chars');
    }
  }
  if (o.pinned !== undefined) {
    if (typeof o.pinned === 'boolean') {
      out.pinned = o.pinned;
    } else {
      errors.push('pinned must be a boolean');
    }
  }

  if (errors.length) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], value: out };
}
