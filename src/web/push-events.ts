import type { IPushNotification } from './push-sender';

// Only these notification states warrant waking someone's phone — a clear/normal transition does not.
const ALERTING = new Set(['emergency', 'alarm', 'alert', 'warn', 'warning']);

/**
 * Decide whether a logged event should become a push, and shape it. Mirrors the Events feed's
 * humanising so a notification reads the same as the in-app row, and deep-links to the screen that
 * answers it (safety console for MOB/anchor, the events feed otherwise). Returns null for events that
 * shouldn't push (a non-alerting state). Pure — no IO — so it's unit-tested directly.
 */
export function notificationForEvent(
  type: string,
  state: string | undefined,
  message: string | undefined,
): IPushNotification | null {
  if (!state || !ALERTING.has(state.toLowerCase())) return null;

  const offline = /^camera\.(.+)\.offline$/.exec(type);
  let title: string;
  let url = '#/review/events';
  let body = message ?? '';

  if (type === 'mob') {
    title = 'Man overboard';
    url = '#/safety';
  } else if (offline) {
    title = `Camera offline: ${offline[1]}`;
  } else if (/^incident/.test(type)) {
    title = 'Incident captured';
  } else if (/^anchor/.test(type)) {
    title = 'Anchor watch';
    url = '#/safety';
  } else if (/^frigate/.test(type)) {
    title = 'Camera detection';
    // Honest: a user-run Frigate sees close range, not a hazard/MOB-at-distance detector.
    body = message ? `${message} (close-range detection)` : 'Close-range detection';
  } else {
    title = type;
  }

  return { title, body: body || title, tag: type, url };
}
