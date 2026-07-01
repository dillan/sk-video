import { ApiError } from '../api';

/** A transient honesty/status note shown over the video (caution = amber, info = neutral). */
export interface IMsg {
  kind: 'caution' | 'info';
  text: string;
}

/**
 * Map a failed camera action to honest, actionable copy. Prefers the server's diagnosed next step
 * (a 502 ONVIF failure carries an `error` hint + `reason`; see src/onvif/onvif-errors.ts) over a
 * generic retry, and gives specific copy for sign-in (401) and unsupported/channel-full (409).
 */
export function actionMessage(err: unknown, what: string): IMsg {
  if (err instanceof ApiError) {
    if (err.status === 401)
      return { kind: 'caution', text: 'Sign in to Signal K to control cameras.' };
    if (err.status === 409 && what === 'record') {
      return { kind: 'caution', text: 'Recording channels full — stop one to record.' };
    }
    if (err.status === 409) return { kind: 'caution', text: 'This camera doesn’t support that.' };
    if (err.hint) return { kind: 'caution', text: err.hint };
  }
  return { kind: 'caution', text: `Couldn’t ${what} — try again.` };
}
