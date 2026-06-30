import { fetchVapidPublicKey, subscribePush, unsubscribePush } from '../api';

/**
 * Decode a URL-safe, unpadded base64 VAPID key (what the server returns) into the Uint8Array that
 * `pushManager.subscribe({ applicationServerKey })` requires. Pure — unit-tested directly.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type TPushState = 'unsupported' | 'denied' | 'on' | 'off';

function supported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current opt-in state for the safety-alerts toggle. */
export async function currentPushState(): Promise<TPushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/**
 * Opt this device in: ask permission, fetch the server's VAPID key, subscribe with the push service,
 * and register the subscription with the plugin. Returns the resulting state. Throws on a real error
 * (network / server) so the caller can show it; a user-denied permission resolves to 'denied'.
 */
export async function enablePush(): Promise<TPushState> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const key = await fetchVapidPublicKey();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true, // required by browsers — every push must show a notification
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  });
  await subscribePush(sub.toJSON());
  return 'on';
}

/** Opt this device out: unsubscribe from the push service and drop it server-side. */
export async function disablePush(): Promise<TPushState> {
  if (!supported()) return 'unsupported';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await unsubscribePush(endpoint).catch(() => undefined); // server cleanup is best-effort
  }
  return 'off';
}
