/**
 * Pure parsing + intrusion classification for Frigate's `frigate/events` MQTT messages. This plugin
 * CONSUMES a user-run Frigate (never bundled) — it does no inference itself. A message is
 * {type:'new'|'update'|'end', before, after}; `after` carries the tracked object's id/camera/label/
 * score/zones and whether a clip exists. Detection is COCO-class and close-range only (person/car/
 * boat); it must never be presented as hazard / deadhead / MOB-at-distance detection.
 */

export const FRIGATE_EVENT_TOPIC = 'frigate/events';

export interface IFrigateObject {
  id: string;
  camera: string;
  label: string;
  score?: number;
  top_score?: number;
  false_positive?: boolean;
  start_time?: number;
  end_time?: number | null;
  has_clip?: boolean;
  has_snapshot?: boolean;
  entered_zones?: unknown;
  current_zones?: unknown;
}

export interface IFrigateEventMessage {
  type: 'new' | 'update' | 'end';
  before?: IFrigateObject;
  after: IFrigateObject;
}

export interface IFrigateNormalized {
  id: string;
  camera: string;
  label: string;
  /** The higher of score / top_score, 0..1. */
  score: number;
  hasClip: boolean;
  enteredZones: string[];
  ended: boolean;
}

export interface IFrigateMatchConfig {
  /** Object labels that count as an intrusion (e.g. person, car, boat). */
  labels: string[];
  /** Minimum detection score (0..1). */
  minScore: number;
  /** Zones that must be entered; empty means any. */
  zones: string[];
}

/** Parse a raw MQTT payload (string/bytes/object) into a Frigate event message, or null if it isn't one. */
export function parseFrigateEvent(payload: unknown): IFrigateEventMessage | null {
  let obj: unknown = payload;
  if (typeof payload === 'string' || payload instanceof Uint8Array) {
    try {
      const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
      obj = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const m = obj as { type?: unknown; after?: unknown };
  if (m.type !== 'new' && m.type !== 'update' && m.type !== 'end') {
    return null;
  }
  const after = m.after;
  if (!after || typeof after !== 'object') {
    return null;
  }
  const a = after as Record<string, unknown>;
  if (typeof a.id !== 'string' || typeof a.camera !== 'string' || typeof a.label !== 'string') {
    return null;
  }
  return obj as IFrigateEventMessage;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((z): z is string => typeof z === 'string') : [];
}

/** Normalize a parsed message and decide whether it qualifies as an intrusion under `config`. */
export function classifyEvent(
  msg: IFrigateEventMessage,
  config: IFrigateMatchConfig,
): { object: IFrigateNormalized; qualifies: boolean } {
  const a = msg.after;
  const score = Math.max(asNumber(a.top_score), asNumber(a.score));
  const enteredZones = asStringArray(a.entered_zones);
  const object: IFrigateNormalized = {
    id: a.id,
    camera: a.camera,
    label: a.label,
    score,
    hasClip: a.has_clip === true,
    enteredZones,
    ended: msg.type === 'end',
  };
  const qualifies =
    config.labels.includes(a.label) &&
    score >= config.minScore &&
    a.false_positive !== true &&
    (config.zones.length === 0 || enteredZones.some((z) => config.zones.includes(z)));
  return { object, qualifies };
}

/** A Frigate event id (e.g. "1607123955.475377-mwz0e6") sanitized into a safe slug for keys/names. */
export function frigateSlug(eventId: string): string {
  return eventId.replace(/[^A-Za-z0-9-]/g, '-');
}
