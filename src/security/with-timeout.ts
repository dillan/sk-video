/**
 * Races a promise against a timeout so a slow/hung dependency (e.g. a DNS lookup against an
 * unresponsive resolver on a flaky boat network) can't stall the caller indefinitely. Rejects with a
 * timeout Error if the deadline passes first; otherwise settles exactly as the wrapped promise did.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'operation timed out',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
