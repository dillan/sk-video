/**
 * Races a promise against a timeout so a slow/hung dependency (e.g. a DNS lookup against an
 * unresponsive resolver on a flaky boat network) can't stall the caller indefinitely. Rejects with a
 * timeout Error if the deadline passes first; otherwise settles exactly as the wrapped promise did.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */
export function withTimeout<T>(_promise: Promise<T>, _ms: number, _message?: string): Promise<T> {
  return Promise.resolve(undefined as T);
}
