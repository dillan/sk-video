import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { SK_ROOT } from '../api';

/**
 * The in-app sign-in surface (states 4/5/6). SK Video has no account system — these are the boat's
 * Signal K credentials. It's non-modal: it sits in a banner above the live console so the video and
 * safety state stay visible behind it; a lapsed session is informational, never a safety alarm.
 *
 * It drives the AuthProvider (one sign-in path for the whole app): submit calls signIn(); the busy and
 * error states come from the provider (state 5 disables the form, state 6 shows the message). A
 * low-prominence "Go to Signal K to sign in" link is the redirect fallback for anyone who prefers the
 * server's own login. Calm copy, show/hide password, Enter-to-submit, password-manager friendly.
 */
export function SignIn() {
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
    <form className="reauth signin" onSubmit={submit} aria-label="Sign in to Signal K">
      <span className="signin__label">Sign in with your Signal K credentials</span>
      <input
        className="signin__field"
        autoFocus
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
      <button
        type="submit"
        className="iconbtn iconbtn--wide iconbtn--on"
        disabled={busy || !username}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {signInError && <span className="chip chip--caution">{signInError}</span>}
      <a className="signin__fallback" href={`${SK_ROOT}/admin/#/login`}>
        Go to Signal K to sign in
      </a>
    </form>
  );
}
