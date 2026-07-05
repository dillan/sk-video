/**
 * The read-only indicator (state 8): a persistent, calm amber ribbon under the shell strip. It is
 * informational, never an alarm — the escalation colour (red) is reserved for safety. Write controls
 * are separately disabled-with-reason via useWriteGate; this ribbon explains the posture and the
 * honest remedy: a signed-in read-only user must ask an admin (signing in again won't help).
 */
export function ReadOnlyRibbon() {
  return (
    <div className="ro-ribbon" role="status">
      <strong>Read-only access</strong> — you can watch but not control. Ask your Signal K
      administrator for write access.
    </div>
  );
}
