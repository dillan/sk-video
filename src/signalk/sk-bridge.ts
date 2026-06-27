import { redactUrl } from '../security/redact';

/**
 * The Signal K data-fusion bridge: the one place this plugin talks to the Signal K bus. It emits
 * deltas, reads vessel self-state, raises/clears notifications, and registers PUT/action handlers —
 * each feature-detected against the (version-varying) server API and degrading gracefully when a
 * capability is missing. Camera, snapshot, MOB and watch features consume this rather than touching
 * `app` directly.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
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
  debug?: (msg: string) => void;
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

const NULL_READING: ISelfReading<never> = { value: null };

export class SignalKBridge {
  constructor(
    private readonly app: ISignalKApp,
    private readonly pluginId: string,
    _options: ISignalKBridgeOptions = {},
  ) {
    void this.app;
    void this.pluginId;
  }

  /** True when the server exposes delta emission. */
  get canEmit(): boolean {
    return false;
  }

  /** Emit one or more Signal K path/value updates as a single delta. */
  emit(_values: IDeltaValue | IDeltaValue[]): boolean {
    return false;
  }

  /** Snapshot of vessel self-state, each field normalised to a value plus optional age. */
  getSelfState(): ISelfState {
    return {
      position: NULL_READING,
      headingTrue: NULL_READING,
      speedOverGround: NULL_READING,
      courseOverGroundTrue: NULL_READING,
      depth: NULL_READING,
      wind: { speedApparent: NULL_READING, angleApparent: NULL_READING },
    };
  }

  /** Raise (or update) a notification keyed by `key`. */
  raiseNotification(_key: string, _options: INotificationOptions): boolean {
    return false;
  }

  /** Clear a previously raised notification keyed by `key`. */
  clearNotification(_key: string): boolean {
    return false;
  }

  /** Register a PUT/action handler on `vessels.self` for `path` (server auth is inherited). */
  registerAction(_path: string, _handler: ActionHandler): boolean {
    return false;
  }

  private log(msg: string): void {
    this.app.debug?.(redactUrl(`[${this.pluginId}] ${msg}`));
  }
}
