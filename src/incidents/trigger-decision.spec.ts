import { describe, it, expect } from 'vitest';
import { shouldTrigger, DEFAULT_TRIGGER_STATES, type ITriggerState } from './trigger-decision';

const cfg = { states: DEFAULT_TRIGGER_STATES, cooldownMs: 60_000 };
const fresh = (): ITriggerState => ({ lastFiredAtByKey: {} });

describe('shouldTrigger', () => {
  it('fires on a configured alarm state and returns the path key + message reason', () => {
    const d = {
      path: 'notifications.navigation.anchor',
      value: { state: 'alarm', message: 'dragging' },
    };
    const r = shouldTrigger(d, cfg, fresh(), 1000);
    expect(r.fire).toBe(true);
    expect(r.key).toBe('notifications.navigation.anchor');
    expect(r.state).toBe('alarm');
    expect(r.reason).toBe('dragging');
  });

  it('does not fire on a non-alarming state or a non-object value', () => {
    expect(shouldTrigger({ path: 'p', value: { state: 'normal' } }, cfg, fresh(), 0).fire).toBe(
      false,
    );
    expect(shouldTrigger({ path: 'p', value: 'alarm' }, cfg, fresh(), 0).fire).toBe(false);
    expect(shouldTrigger({ path: 'p', value: null }, cfg, fresh(), 0).fire).toBe(false);
  });

  it('debounces within the cooldown for the same path but fires for a different path', () => {
    const state: ITriggerState = { lastFiredAtByKey: { 'notifications.a': 1000 } };
    const within = shouldTrigger(
      { path: 'notifications.a', value: { state: 'alert' } },
      cfg,
      state,
      1000 + 30_000,
    );
    expect(within.fire).toBe(false);
    const other = shouldTrigger(
      { path: 'notifications.b', value: { state: 'alert' } },
      cfg,
      state,
      1000 + 30_000,
    );
    expect(other.fire).toBe(true);
    const after = shouldTrigger(
      { path: 'notifications.a', value: { state: 'alert' } },
      cfg,
      state,
      1000 + 61_000,
    );
    expect(after.fire).toBe(true);
  });

  it('is pure — does not mutate the trigger state', () => {
    const state = fresh();
    shouldTrigger({ path: 'p', value: { state: 'alarm' } }, cfg, state, 5);
    expect(state.lastFiredAtByKey).toEqual({});
  });
});
