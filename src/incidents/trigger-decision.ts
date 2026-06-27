import type { AlarmState } from '../signalk/sk-bridge';

/**
 * Pure decision for whether an incoming notifications.* delta should fire an incident bundle. This is
 * the ONLY auto-trigger policy; index.ts wiring (excluded from coverage) calls it so the behavior
 * stays in a unit-tested module. It gates on the alarm state and debounces per notification path, so
 * a flapping alarm produces one bundle, not many. Manual triggers bypass this entirely.
 */

export interface INormalizedDeltaLike {
  path: string;
  value: unknown;
  timestamp?: string;
}

export interface ITriggerConfig {
  states: AlarmState[];
  cooldownMs: number;
}

export interface ITriggerState {
  lastFiredAtByKey: Record<string, number>;
}

/** Auto-trigger only on genuinely alarming states; nominal/normal/warn never fire a bundle. */
export const DEFAULT_TRIGGER_STATES: AlarmState[] = ['alert', 'alarm', 'emergency'];

export interface ITriggerDecision {
  fire: boolean;
  reason?: string;
  key?: string;
  state?: string;
}

/**
 * Decide whether `delta` should fire. Fires only when the delta value is a notification object whose
 * state is in cfg.states and the per-path cooldown has elapsed. Pure: it does NOT mutate state — the
 * caller stamps lastFiredAtByKey[key] = now on a fire.
 */
export function shouldTrigger(
  delta: INormalizedDeltaLike,
  cfg: ITriggerConfig,
  state: ITriggerState,
  now: number,
): ITriggerDecision {
  const v = delta.value;
  if (typeof v !== 'object' || v === null) {
    return { fire: false };
  }
  const notifState = (v as { state?: unknown }).state;
  if (typeof notifState !== 'string' || !cfg.states.includes(notifState as AlarmState)) {
    return { fire: false };
  }
  const key = delta.path;
  const last = state.lastFiredAtByKey[key];
  if (last !== undefined && now - last <= cfg.cooldownMs) {
    return { fire: false };
  }
  const message = (v as { message?: unknown }).message;
  return {
    fire: true,
    key,
    state: notifState,
    reason: typeof message === 'string' ? message : undefined,
  };
}
