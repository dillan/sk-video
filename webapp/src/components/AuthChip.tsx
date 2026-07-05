import { useAuth } from '../lib/auth';
import type { AuthState } from '../lib/auth-state';

/**
 * One glanceable indicator of the current auth posture, in the shell status strip. Colour follows the
 * design: green for an open server, a neutral chip with a green dot when signed in, calm amber for
 * read-only / a lapsed session (informational, never the safety red), blue for a needed sign-in, and
 * slate for offline. Night-Red safe: the green and blue variants have red-family remaps in theme.css.
 */
interface Treatment {
  cls: string;
  label: string;
  dot?: boolean;
}

function treatmentFor(state: AuthState, username?: string): Treatment {
  switch (state) {
    case 'open':
      return { cls: 'chip--online', label: 'Open server' };
    case 'signedIn':
      return {
        cls: 'chip--neutral',
        label: username ? `${username} · full control` : 'Signed in',
        dot: true,
      };
    case 'readonly':
      return { cls: 'chip--caution', label: 'Read-only' };
    case 'reauth':
      return { cls: 'chip--caution', label: 'Session expired' };
    case 'signinRequired':
    case 'signingIn':
    case 'signinFailed':
      return { cls: 'chip--info', label: 'Sign in required' };
    case 'unreachable':
      return { cls: 'chip--offline', label: 'Offline' };
    default:
      return { cls: 'chip--neutral', label: 'Checking session…' };
  }
}

export function AuthChip() {
  const { state, username } = useAuth();
  const t = treatmentFor(state, username);
  return (
    <span className={`chip ${t.cls} authchip`} title="Authentication">
      {t.dot && <span className="authchip__dot" aria-hidden="true" />}
      {t.label}
    </span>
  );
}
