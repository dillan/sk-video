import { useState } from 'react';
import { login, fetchSession, type ISessionInfo } from '../api';

/**
 * The in-app sign-in surface (auth brief, decision A). SK Video has no account system — these are the
 * boat's Signal K credentials. It's non-modal: it sits in a banner above the live console so the video
 * and safety state stay visible behind it; a lapsed session is informational, never a safety alarm.
 * Calm copy, show/hide password, Enter-to-submit, password-manager friendly (autocomplete + input types).
 */
export function SignIn({ onSignedIn }: { onSignedIn: (s: ISessionInfo) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !username) return;
    setBusy(true);
    setError(null);
    login(username, password)
      .then(() => fetchSession())
      .then(onSignedIn)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Sign-in failed.');
        setPassword(''); // clear the password but keep the username + focus for a quick retry
      })
      .finally(() => setBusy(false));
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
      {error && <span className="chip chip--caution">{error}</span>}
    </form>
  );
}
