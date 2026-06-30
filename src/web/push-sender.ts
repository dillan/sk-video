import type { IPushSubscription } from './push-store';

/** The notification the service worker renders; serialized as the push payload. */
export interface IPushNotification {
  title: string;
  body: string;
  /** Collapse key — a later same-tag push replaces the earlier one on the device. */
  tag?: string;
  /** Deep link opened when the notification is tapped (a hash route). */
  url?: string;
}

/** Sends one encrypted payload to one subscription; resolves with the push service's status. */
export type ISendFn = (sub: IPushSubscription, payload: string) => Promise<{ statusCode: number }>;

export interface IFanOutDeps {
  send: ISendFn;
  /** Called with the endpoint of any subscription the push service reports as permanently gone. */
  onGone: (endpoint: string) => void;
  log?: (message: string) => void;
}

// A 404/410 from the push service means the subscription is permanently dead (the user cleared site
// data, the browser rotated it, etc.) — prune it. Any other failure is transient; keep the sub.
const GONE = new Set([404, 410]);

/**
 * Fan a single notification out to every subscribed device, best-effort. Each send is independent: a
 * dead subscription is pruned via `onGone`, a transient failure is logged and left in place, and one
 * failure never blocks delivery to the others. Returns counts for observability. Pure with respect to
 * IO — the actual encrypted POST is the injected `send` (so this is unit-tested without a network).
 */
export async function fanOutPush(
  subs: IPushSubscription[],
  notification: IPushNotification,
  deps: IFanOutDeps,
): Promise<{ sent: number; pruned: number }> {
  const payload = JSON.stringify(notification);
  let sent = 0;
  let pruned = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await deps.send(sub, payload);
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status !== undefined && GONE.has(status)) {
          deps.onGone(sub.endpoint);
          pruned += 1;
        } else {
          deps.log?.(`push send failed (${status ?? 'no status'}) for ${sub.endpoint}`);
        }
      }
    }),
  );
  return { sent, pruned };
}
