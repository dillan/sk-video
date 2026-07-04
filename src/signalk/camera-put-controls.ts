import type { ActionHandler, IActionResult, IMetaEntry } from './sk-bridge';
import { isValidPtzToken } from '../onvif/ptz-command';

/**
 * The curated set of camera controls exposed as standard Signal K PUT paths, so a generic client
 * (KIP's boolean-switch / multi-state widgets discover writable paths via `meta.supportsPut`) can
 * flip a spotlight, toggle recording, or recall a PTZ preset with no sk-video-specific code.
 * Deliberately small and operations-shaped: continuous PTZ jog stays on the plugin REST API where
 * a joystick belongs. Values are validated here, before anything reaches ONVIF or the recorder;
 * the server's own PUT auth gates every request.
 */

export interface ICameraControlFlags {
  /** The camera advertised a classified spotlight aux command. */
  spotlight: boolean;
  /** Recording is available on this install (manager present; tier may still refuse at start). */
  recording: boolean;
  /** The camera is PTZ-capable, so preset recall makes sense. */
  presets: boolean;
}

export interface ICameraControlActions {
  setSpotlight(id: string, on: boolean): Promise<void>;
  /** Start/stop recording; returns false when the tier/channel budget refuses a start. */
  setRecording(id: string, on: boolean): boolean;
  gotoPreset(id: string, token: string): Promise<void>;
}

export interface ICameraPutControl {
  /** The vessels.self path the PUT handler registers on. */
  path: string;
  /** The path's meta (displayName + supportsPut) so clients can discover the control. */
  meta: IMetaEntry;
  handler: ActionHandler;
}

const COMPLETED: IActionResult = { state: 'COMPLETED', statusCode: 200 };
const badRequest = (message: string): IActionResult => ({
  state: 'FAILED',
  statusCode: 400,
  message,
});

/** Accept booleans and 0/1 — what generic switch widgets send — and nothing else. */
function parseOnOff(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return null;
}

export function buildCameraPutControls(
  id: string,
  name: string,
  flags: ICameraControlFlags,
  actions: ICameraControlActions,
): ICameraPutControl[] {
  const controls: ICameraPutControl[] = [];

  if (flags.spotlight) {
    const path = `cameras.${id}.spotlight`;
    controls.push({
      path,
      meta: {
        path,
        value: {
          displayName: `${name} — spotlight`,
          description: 'true switches the camera spotlight on, false switches it off.',
          supportsPut: true,
        },
      },
      handler: (value) => {
        const on = parseOnOff(value);
        if (on === null) return badRequest('spotlight takes true or false');
        return actions.setSpotlight(id, on).then(() => COMPLETED);
      },
    });
  }

  if (flags.recording) {
    const path = `cameras.${id}.recording`;
    controls.push({
      path,
      meta: {
        path,
        value: {
          displayName: `${name} — recording`,
          description: 'true starts continuous recording for this camera, false stops it.',
          supportsPut: true,
        },
      },
      handler: (value) => {
        const on = parseOnOff(value);
        if (on === null) return badRequest('recording takes true or false');
        if (!actions.setRecording(id, on)) {
          return {
            state: 'FAILED',
            statusCode: 409,
            message: 'recording unavailable — channel limit reached or disabled for this tier',
          };
        }
        return COMPLETED;
      },
    });
  }

  if (flags.presets) {
    const path = `cameras.${id}.activePreset`;
    controls.push({
      path,
      meta: {
        path,
        value: {
          displayName: `${name} — active PTZ preset`,
          description: 'Set to a preset token to steer the camera there.',
          supportsPut: true,
        },
      },
      handler: (value) => {
        if (!isValidPtzToken(value)) return badRequest('activePreset takes a preset token');
        return actions.gotoPreset(id, value).then(() => COMPLETED);
      },
    });
  }

  return controls;
}
