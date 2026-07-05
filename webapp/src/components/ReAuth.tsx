import { useState } from 'react';
import { useAuth } from '../lib/auth';

/**
 * The re-auth surface (state 7) — the 2-a.m.-flaky-marina-wifi moment, and the most important screen
 * in the auth brief. It is a NON-MODAL amber recovery banner over the still-live console: the last
 * video frame stays on screen (VideoPlayer's own stale stamp) and the safety strip stays stamped, so
 * a lapsed session never blanks the picture or the safety state. Because it never navigates and the
 * screen stays mounted behind it, the operator lands exactly where they were after signing back in.
 *
 * Driven by the provider (one sign-in path). Deliberately does NOT autofocus — an autofocus mid-watch
 * would pop the on-screen keyboard over the video. Amber, never blue/red: a lapse is informational.
 */
export function ReAuth() {
  const { signIn, signInError, state } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const busy = state === 'signingIn';

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (busy || !username) return;
    void signIn(username, password);
  };

  return (
    <form className="reauth reauth--recover" onSubmit={submit} aria-label="Re-authenticate">
      <div className="reauth__msg">
        <strong>Your session expired.</strong> Sign in to keep controlling cameras — nothing was
        lost, you&rsquo;ll land right back here.
      </div>
      <input
        className="signin__field"
        autoComplete="username"
        name="username"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        disabled={busy}
      />
      <span className="signin__pw">
        <input
          className="signin__field"
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          name="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <button
          type="button"
          className="signin__toggle"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
      <button type="submit" className="reauth__submit" disabled={busy || !username}>
        {busy ? 'Signing in…' : 'Re-authenticate'}
      </button>
      {signInError && <span className="chip chip--caution">{signInError}</span>}
    </form>
  );
}
