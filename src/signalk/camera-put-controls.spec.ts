import { describe, it, expect, vi } from 'vitest';
import { buildCameraPutControls, type ICameraControlActions } from './camera-put-controls';
import type { IActionResult } from './sk-bridge';

function makeActions(over: Partial<ICameraControlActions> = {}): ICameraControlActions {
  return {
    setSpotlight: vi.fn(async () => undefined),
    setRecording: vi.fn(() => true),
    gotoPreset: vi.fn(async () => undefined),
    ...over,
  };
}

const ALL = { spotlight: true, recording: true, presets: true };

async function settle(r: IActionResult | Promise<IActionResult>): Promise<IActionResult> {
  return await r;
}

describe('buildCameraPutControls', () => {
  it('builds a control per supported capability only', () => {
    const none = buildCameraPutControls(
      'bow',
      'Bow Camera',
      {
        spotlight: false,
        recording: false,
        presets: false,
      },
      makeActions(),
    );
    expect(none).toEqual([]);

    const paths = buildCameraPutControls('bow', 'Bow Camera', ALL, makeActions()).map(
      (c) => c.path,
    );
    expect(paths).toEqual([
      'cameras.bow.spotlight',
      'cameras.bow.recording',
      'cameras.bow.activePreset',
    ]);
  });

  it('marks every control path writable via supportsPut meta with a human displayName', () => {
    const controls = buildCameraPutControls('bow', 'Bow Camera', ALL, makeActions());
    for (const control of controls) {
      expect(control.meta.path).toBe(control.path);
      expect(control.meta.value.supportsPut).toBe(true);
      expect(String(control.meta.value.displayName)).toContain('Bow Camera');
    }
  });

  it('spotlight accepts booleans (and 0/1) and rejects anything else without touching the camera', async () => {
    const actions = makeActions();
    const [spotlight] = buildCameraPutControls('bow', 'Bow Camera', ALL, actions);
    expect((await settle(spotlight.handler(true))).state).toBe('COMPLETED');
    expect((await settle(spotlight.handler(0))).state).toBe('COMPLETED');
    expect(actions.setSpotlight).toHaveBeenNthCalledWith(1, 'bow', true);
    expect(actions.setSpotlight).toHaveBeenNthCalledWith(2, 'bow', false);

    const bad = await settle(spotlight.handler('banana'));
    expect(bad.state).toBe('FAILED');
    expect(bad.statusCode).toBe(400);
    expect(actions.setSpotlight).toHaveBeenCalledTimes(2);
  });

  it('recording maps a tier refusal to a 409-style failure', async () => {
    const actions = makeActions({ setRecording: vi.fn((_id, on) => !on) }); // start refused, stop ok
    const controls = buildCameraPutControls('bow', 'Bow Camera', ALL, actions);
    const recording = controls.find((c) => c.path === 'cameras.bow.recording')!;
    const refused = await settle(recording.handler(true));
    expect(refused.state).toBe('FAILED');
    expect(refused.statusCode).toBe(409);
    expect((await settle(recording.handler(false))).state).toBe('COMPLETED');
  });

  it('activePreset validates the token before it can reach ONVIF', async () => {
    const actions = makeActions();
    const controls = buildCameraPutControls('bow', 'Bow Camera', ALL, actions);
    const preset = controls.find((c) => c.path === 'cameras.bow.activePreset')!;
    expect((await settle(preset.handler('dock-view'))).state).toBe('COMPLETED');
    expect(actions.gotoPreset).toHaveBeenCalledWith('bow', 'dock-view');

    for (const evil of ['../escape', 'a token', '', 42, { token: 'x' }]) {
      const r = await settle(preset.handler(evil));
      expect(r.state).toBe('FAILED');
      expect(r.statusCode).toBe(400);
    }
    expect(actions.gotoPreset).toHaveBeenCalledTimes(1);
  });
});
