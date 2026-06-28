import { redactUrl } from '../security/redact';

/**
 * The Signal K data-fusion bridge: the one place this plugin talks to the Signal K bus. It emits
 * deltas, reads vessel self-state, raises/clears notifications, and registers PUT/action handlers —
 * each feature-detected against the (version-varying) server API and degrading gracefully when a
 * capability is missing. Camera, snapshot, MOB and watch features consume this rather than touching
 * `app` directly.
 */

export type AlarmState = 'nominal' | 'normal' | 'alert' | 'warn' | 'alarm' | 'emergency';

export interface IDeltaValue {
  path: string;
  value: unknown;
}

export interface IDeltaMessage {
  updates: { values: IDeltaValue[]; timestamp?: string; $source?: string }[];
}

export interface INotificationOptions {
  state: AlarmState;
  message: string;
  data?: Record<string, unknown>;
}

export interface IActionResult {
  state: 'COMPLETED' | 'PENDING' | 'FAILED';
  statusCode?: number;
  message?: string;
}

export type ActionHandler = (value: unknown) => IActionResult | Promise<IActionResult>;

/**
 * The minimal structural subset of the Signal K `ServerAPI` the bridge depends on. Every member is
 * optional so the bridge can feature-detect and keep working on older or partial servers.
 */
export interface ISignalKApp {
  handleMessage?(id: string, msg: IDeltaMessage): void;
  getSelfPath?(path: string): unknown;
  registerPutHandler?(
    context: string,
    path: string,
    cb: (
      context: string,
      path: string,
      value: unknown,
      callback: (r: IActionResult) => void,
    ) => IActionResult,
    source?: string,
  ): void;
  notifications?: {
    raise?(o: {
      state: AlarmState;
      message: string;
      path?: string;
      data?: Record<string, unknown>;
    }): string;
    update?(
      id: string,
      o: { state?: AlarmState; message?: string; data?: Record<string, unknown> },
    ): void;
    clear?(id: string): void;
  };
  /** Bacon-style self-path delta stream; present on full servers, absent on partial ones. */
  streambundle?: {
    getSelfBus(path: string): {
      onValue(cb: (delta: IDeltaLike) => void): () => void;
    };
  };
  debug?: (msg: string) => void;
}

/** A normalized incoming delta as the subscription stream yields it. */
export interface IDeltaLike {
  path: string;
  value: unknown;
  timestamp?: string;
}

export interface ISelfReading<T> {
  /** The value, or null when the path is absent/unavailable. */
  value: T | null;
  /** ISO timestamp from the data model, when present. */
  timestamp?: string;
  /** Age of the reading in ms relative to the bridge clock, when a timestamp is present. */
  ageMs?: number;
}

export interface ISelfState {
  position: ISelfReading<{ latitude: number; longitude: number }>;
  headingTrue: ISelfReading<number>;
  speedOverGround: ISelfReading<number>;
  courseOverGroundTrue: ISelfReading<number>;
  depth: ISelfReading<number>;
  wind: {
    speedApparent: ISelfReading<number>;
    angleApparent: ISelfReading<number>;
  };
}

export interface ISignalKBridgeOptions {
  /** Injectable clock (ms) for deterministic reading-age computation in tests. */
  now?: () => number;
}

/** The vessel self paths the bridge reads for a telemetry snapshot. */
const SELF_PATHS = {
  position: 'navigation.position',
  headingTrue: 'navigation.headingTrue',
  speedOverGround: 'navigation.speedOverGround',
  courseOverGroundTrue: 'navigation.courseOverGroundTrue',
  depth: 'environment.depth.belowTransducer',
  windSpeedApparent: 'environment.wind.speedApparent',
  windAngleApparent: 'environment.wind.angleApparent',
} as const;

export class SignalKBridge {
  /** Notification ids keyed by our stable notification key, so a raise can later update/clear. */
  private readonly notificationIds = new Map<string, string>();
  private readonly now: () => number;

  constructor(
    private readonly app: ISignalKApp,
    private readonly pluginId: string,
    options: ISignalKBridgeOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  /** True when the server exposes delta emission. */
  get canEmit(): boolean {
    return typeof this.app.handleMessage === 'function';
  }

  /** Emit one or more Signal K path/value updates as a single delta. */
  emit(values: IDeltaValue | IDeltaValue[]): boolean {
    if (typeof this.app.handleMessage !== 'function') {
      this.log('handleMessage unavailable; delta dropped');
      return false;
    }
    const list = Array.isArray(values) ? values : [values];
    if (list.length === 0) {
      return false;
    }
    this.app.handleMessage(this.pluginId, { updates: [{ values: list }] });
    return true;
  }

  /** Snapshot of vessel self-state, each field normalised to a value plus optional age. */
  getSelfState(): ISelfState {
    return {
      position: this.readSelf(SELF_PATHS.position),
      headingTrue: this.readSelf(SELF_PATHS.headingTrue),
      speedOverGround: this.readSelf(SELF_PATHS.speedOverGround),
      courseOverGroundTrue: this.readSelf(SELF_PATHS.courseOverGroundTrue),
      depth: this.readSelf(SELF_PATHS.depth),
      wind: {
        speedApparent: this.readSelf(SELF_PATHS.windSpeedApparent),
        angleApparent: this.readSelf(SELF_PATHS.windAngleApparent),
      },
    };
  }

  /** Raise (or, if already raised under `key`, update) a notification. */
  raiseNotification(key: string, options: INotificationOptions): boolean {
    const n = this.app.notifications;
    if (n?.raise) {
      // Guard the API: a server whose notifications implementation throws must not take down a safety
      // path (MOB/incident/watchdog). On failure, degrade to a notifications.* delta on the same path.
      try {
        const existing = this.notificationIds.get(key);
        if (existing !== undefined) {
          n.update?.(existing, {
            state: options.state,
            message: options.message,
            data: options.data,
          });
        } else {
          this.notificationIds.set(
            key,
            n.raise({
              state: options.state,
              message: options.message,
              path: this.notifPath(key),
              data: options.data,
            }),
          );
        }
        return true;
      } catch (err) {
        this.log(`notifications.raise(${key}) failed: ${errMessage(err)}; falling back to a delta`);
        return this.emit(this.notificationDelta(key, options));
      }
    }
    // No notifications API on this server: fall back to a notifications.* delta.
    return this.emit(this.notificationDelta(key, options));
  }

  /** Clear a previously raised notification keyed by `key`. */
  clearNotification(key: string): boolean {
    const n = this.app.notifications;
    const id = this.notificationIds.get(key);
    if (n?.clear && id !== undefined) {
      try {
        n.clear(id);
      } catch (err) {
        this.log(`notifications.clear(${key}) failed: ${errMessage(err)}`);
      }
      this.notificationIds.delete(key);
      return true;
    }
    if (!n?.clear) {
      // No notifications API: clear by emitting a normal-state delta on the same path.
      this.notificationIds.delete(key);
      return this.emit(this.notificationDelta(key, { state: 'normal', message: '' }));
    }
    return false; // API present, but nothing was raised under this key.
  }

  /**
   * Register a PUT/action handler on `vessels.self` for `path`. The server enforces its own auth on
   * PUT requests, so registering here inherits that — there is no unauthenticated trigger.
   */
  registerAction(path: string, handler: ActionHandler): boolean {
    const reg = this.app.registerPutHandler;
    if (typeof reg !== 'function') {
      this.log(`registerPutHandler unavailable; action ${path} not registered`);
      return false;
    }
    reg.call(
      this.app,
      'vessels.self',
      path,
      (_context, _path, value, callback) => {
        try {
          const result = handler(value);
          if (result instanceof Promise) {
            result
              .then(callback)
              .catch((err) =>
                callback({ state: 'FAILED', statusCode: 500, message: errMessage(err) }),
              );
            return { state: 'PENDING' };
          }
          return result;
        } catch (err) {
          return { state: 'FAILED', statusCode: 500, message: errMessage(err) };
        }
      },
      this.pluginId,
    );
    return true;
  }

  /**
   * Subscribe to a self-path delta stream (e.g. `notifications.*`) for auto-triggering. Returns an
   * unsubscribe function — call it in stop() before the bridge is dropped. Degrades to a no-op (and
   * logs) when the server exposes no streambundle, so a partial server simply never auto-fires.
   */
  onDelta(path: string, cb: (delta: IDeltaLike) => void): () => void {
    const sb = this.app.streambundle;
    if (!sb || typeof sb.getSelfBus !== 'function') {
      this.log(`streambundle unavailable; onDelta(${path}) is a no-op`);
      return () => {};
    }
    try {
      return sb.getSelfBus(path).onValue(cb);
    } catch (err) {
      this.log(`onDelta(${path}) subscription failed: ${errMessage(err)}`);
      return () => {};
    }
  }

  private readSelf<T>(path: string): ISelfReading<T> {
    const get = this.app.getSelfPath;
    if (typeof get !== 'function') {
      return { value: null };
    }
    let raw: unknown;
    try {
      raw = get.call(this.app, path);
    } catch (err) {
      this.log(`getSelfPath(${path}) failed: ${errMessage(err)}`);
      return { value: null };
    }
    if (raw === undefined || raw === null) {
      return { value: null };
    }
    // The full data model may return either the raw value or a { value, timestamp } wrapper.
    if (typeof raw === 'object' && 'value' in raw) {
      const w = raw as { value: unknown; timestamp?: unknown };
      const reading: ISelfReading<T> = { value: (w.value ?? null) as T | null };
      if (typeof w.timestamp === 'string') {
        reading.timestamp = w.timestamp;
        const t = Date.parse(w.timestamp);
        if (!Number.isNaN(t)) {
          reading.ageMs = this.now() - t;
        }
      }
      return reading;
    }
    return { value: raw as T };
  }

  private notifPath(key: string): string {
    return `${this.pluginId}.${key}`;
  }

  private notificationDelta(key: string, options: INotificationOptions): IDeltaValue {
    return {
      path: `notifications.${this.notifPath(key)}`,
      value: {
        state: options.state,
        message: options.message,
        method:
          options.state === 'alarm' || options.state === 'emergency'
            ? ['visual', 'sound']
            : ['visual'],
        ...(options.data ? { data: options.data } : {}),
      },
    };
  }

  private log(msg: string): void {
    this.app.debug?.(redactUrl(`[${this.pluginId}] ${msg}`));
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
