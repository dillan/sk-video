import {
  parseFrigateEvent,
  classifyEvent,
  frigateSlug,
  type IFrigateMatchConfig,
  type IFrigateNormalized,
} from './frigate-events';

/**
 * Orchestrates Frigate intrusion handling: on a qualifying detection it raises a single Signal K
 * notification (deduped per event id), and when the event ends with a clip it fetches + caches that
 * clip and updates the notification with the clip reference. Every IO (notify, clip fetch, clip
 * store) is injected, so the orchestration is unit-testable without MQTT, HTTP, or disk. Bounded
 * memory: the per-event tracking is pruned by age on every message.
 */

const DEFAULT_RETENTION_MS = 60 * 60 * 1000; // forget an event id an hour after first seen
// A burst of simultaneous detection-ends must not fetch+buffer many clips at once and OOM a Pi. Each
// clip fetch is bounded in size by the caller; this bounds how many run concurrently.
const MAX_CONCURRENT_CLIP_FETCHES = 2;

export interface IFrigateClientDeps {
  config: IFrigateMatchConfig;
  /** Raise (or, by key, update) a notification. State is always 'alert' for an intrusion. */
  raiseNotification: (key: string, message: string, data: Record<string, unknown>) => void;
  /** Clear a notification by key — used to auto-expire an old alert (and bound the bridge's map). */
  clearNotification: (key: string) => void;
  /**
   * Map a Frigate camera name to one of OUR camera ids (or null when unknown). A mapped detection
   * alarms on the camera's own path (cameras.<id>.detections.<label>) so every alarm about a
   * camera congregates under one subtree; unmapped cameras keep the legacy per-event key —
   * a camera identity is never guessed.
   */
  resolveCameraId?: (frigateCamera: string) => string | null;
  /** Fetch the finalized clip for an event from Frigate's HTTP API (SSRF-guarded by the caller). */
  fetchClip: (eventId: string) => Promise<Uint8Array>;
  /** Cache the clip bytes; returns the stored asset id, or null if it was rejected (bad type/quota). */
  storeClip: (eventId: string, bytes: Uint8Array) => string | null;
  now?: () => number;
  retentionMs?: number;
  log?: (msg: string) => void;
}

interface IActiveEvent {
  key: string;
  seenAt: number;
  clipHandled: boolean;
}

export class FrigateClient {
  private readonly active = new Map<string, IActiveEvent>();
  private readonly now: () => number;
  private readonly retentionMs: number;
  private clipFetchesInFlight = 0;

  constructor(private readonly deps: IFrigateClientDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.retentionMs = deps.retentionMs ?? DEFAULT_RETENTION_MS;
  }

  /** Handle one raw `frigate/events` payload. Never throws (it runs off the MQTT message callback). */
  handleMessage(payload: unknown): void {
    try {
      const msg = parseFrigateEvent(payload);
      if (!msg) {
        return;
      }
      this.sweep(); // age-based expiry runs on every frigate message, not only qualifying ones
      const { object, qualifies } = classifyEvent(msg, this.deps.config);
      if (!qualifies) {
        return;
      }
      const cameraId = this.deps.resolveCameraId?.(object.camera) ?? null;
      const key = cameraId
        ? `cameras.${cameraId}.detections.${labelSlug(object.label)}`
        : `frigate.${frigateSlug(object.id)}`;
      const existing = this.active.get(object.id);
      if (!existing) {
        this.active.set(object.id, { key, seenAt: this.now(), clipHandled: false });
        this.deps.raiseNotification(
          key,
          this.detectMessage(object),
          notificationData(object, cameraId ? { cameraId } : undefined),
        );
      } else {
        // Sliding retention: a still-tracked object is kept alive (and not re-raised), so it is
        // forgotten only after going quiet for the retention window — never pruned-then-duplicated.
        existing.seenAt = this.now();
      }

      if (object.ended && object.hasClip) {
        const entry = this.active.get(object.id);
        if (entry && !entry.clipHandled) {
          entry.clipHandled = true;
          void this.attachClip(object, key);
        }
      }
    } catch (err) {
      this.deps.log?.(`frigate event handling failed: ${errMessage(err)}`);
    }
  }

  activeEvents(): string[] {
    return [...this.active.keys()];
  }

  /** Clear every outstanding alert (e.g. on plugin stop, while the bridge is still live). */
  reset(): void {
    // Camera+label alarms are shared by every event on that camera — clear each key once.
    const keys = new Set([...this.active.values()].map((entry) => entry.key));
    for (const key of keys) {
      this.deps.clearNotification(key);
    }
    this.active.clear();
  }

  private async attachClip(object: IFrigateNormalized, key: string): Promise<void> {
    if (this.clipFetchesInFlight >= MAX_CONCURRENT_CLIP_FETCHES) {
      // Best-effort: under a detection burst the alert still fires; we just skip this clip rather than
      // pile up many multi-MiB in-memory fetches at once.
      this.deps.log?.(
        `frigate clip skipped for ${object.id}: ${this.clipFetchesInFlight} fetches already in flight`,
      );
      return;
    }
    this.clipFetchesInFlight += 1;
    try {
      const bytes = await this.deps.fetchClip(object.id);
      const assetId = this.deps.storeClip(object.id, bytes);
      if (assetId) {
        this.deps.raiseNotification(
          key,
          `${this.detectMessage(object)} — clip available`,
          notificationData(object, { clip: assetId }),
        );
      }
    } catch (err) {
      this.deps.log?.(`frigate clip fetch failed for ${object.id}: ${errMessage(err)}`);
    } finally {
      this.clipFetchesInFlight -= 1;
    }
  }

  private detectMessage(object: IFrigateNormalized): string {
    return `Frigate: ${object.label} detected on ${object.camera} (${Math.round(object.score * 100)}%).`;
  }

  /**
   * Drop events that have gone quiet for longer than the retention window and clear their alert.
   * Public so a periodic timer can expire the LAST alert even when no more events arrive (the
   * message-driven call alone would never fire in a fully quiet period).
   */
  sweep(): void {
    const cutoff = this.now() - this.retentionMs;
    const expiredKeys = new Set<string>();
    for (const [id, entry] of this.active) {
      if (entry.seenAt < cutoff) {
        expiredKeys.add(entry.key);
        this.active.delete(id);
      }
    }
    // A camera+label alarm is shared: clear it only when its LAST active event has expired.
    for (const key of expiredKeys) {
      if (![...this.active.values()].some((entry) => entry.key === key)) {
        this.deps.clearNotification(key);
      }
    }
  }
}

/** Build the notification payload, surfacing entered zones (when any) and any extra fields (e.g. clip). */
function notificationData(
  object: IFrigateNormalized,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    camera: object.camera,
    label: object.label,
    score: object.score,
    event: object.id,
    ...(object.enteredZones.length > 0 ? { zones: object.enteredZones } : {}),
    ...extra,
  };
}

/** A detection label becomes a notification path segment — flatten anything path-hostile. */
function labelSlug(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'object';
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
