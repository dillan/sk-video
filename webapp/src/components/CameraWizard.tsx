import { useState } from 'react';
import {
  discoverCameras,
  introspectCamera,
  saveCamera,
  setCredentials,
  ApiError,
  type ICandidate,
  type ICamera,
  type ICameraEntry,
} from '../api';
import { capabilityBadges } from '../lib/camera';
import {
  rankCandidates,
  isOnvifCandidate,
  draftFromIntrospect,
  draftFromEntry,
  toResourceBody,
  mergeEdit,
  isValidSlug,
  slugify,
  MOUNTS,
  ROLES,
  type ICameraDraft,
  type Mount,
  type Role,
} from '../lib/onboard';
import { codecLabel } from '../lib/transport';

type Step = 'scan' | 'connect' | 'details';
interface Msg {
  kind: 'caution' | 'info';
  text: string;
}

interface Props {
  onDone: (saved: boolean) => void;
  /** When set, the wizard edits this camera: discovery is skipped, the details step opens pre-filled,
   *  and saving PUTs to this entry's EXISTING id via {@link mergeEdit} — never a new camera. */
  edit?: ICameraEntry;
  /** Presence-only signal for edit mode. The stored login itself is write-only and never fetched. */
  hasStoredLogin?: boolean;
}

/**
 * Zero-typing onboarding: scan the LAN, pick a discovered ONVIF camera (WSD noise like a NAS is ranked
 * down and clearly not-a-camera), enter the camera's write-only login, introspect to pre-fill the form,
 * then save. Credentials go to the ephemeral probe and the write-only store — never into the resource.
 * With `edit`, the same details form edits an existing camera instead.
 */
export function CameraWizard({ onDone, edit, hasStoredLogin = false }: Props) {
  const editing = edit !== undefined;
  const [step, setStep] = useState<Step>(editing ? 'details' : 'scan');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [candidates, setCandidates] = useState<ICandidate[] | null>(null);

  // connect step (in edit mode the empty username/password double as the optional NEW login)
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // details step
  const [draft, setDraft] = useState<ICameraDraft | null>(edit ? draftFromEntry(edit) : null);

  const fail = (err: unknown, what: string): void => {
    if (err instanceof ApiError && err.status === 401) {
      setMsg({
        kind: 'caution',
        text: editing ? 'Sign in to Signal K to save the camera.' : 'Sign in to Signal K to add a camera.',
      });
    } else if (err instanceof ApiError && err.status === 429) {
      setMsg({ kind: 'caution', text: 'Rate-limited — wait a few seconds and try again.' });
    } else {
      setMsg({ kind: 'caution', text: `Couldn’t ${what}.` });
    }
  };

  const scan = (): void => {
    setBusy(true);
    setMsg(null);
    discoverCameras()
      .then((c) => setCandidates(rankCandidates(c)))
      .catch((err: unknown) => fail(err, 'scan the network'))
      .finally(() => setBusy(false));
  };

  const pick = (c: ICandidate): void => {
    setHost(c.host);
    setPort(c.port ? String(c.port) : '');
    setMsg(null);
    setStep('connect');
  };

  const manual = (): void => {
    setHost('');
    setPort('');
    setStep('connect');
  };

  const connect = (): void => {
    if (!host.trim()) {
      setMsg({ kind: 'caution', text: 'Enter the camera’s address.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    introspectCamera({
      host: host.trim(),
      port: port ? Number(port) : undefined,
      username: username || undefined,
      password: password || undefined,
    })
      .then((r) => {
        setDraft(draftFromIntrospect(r, host.trim()));
        setStep('details');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 502) {
          setMsg({
            kind: 'caution',
            text: 'Couldn’t reach or read that camera — check the login.',
          });
        } else {
          fail(err, 'read the camera');
        }
      })
      .finally(() => setBusy(false));
  };

  const save = (): void => {
    if (!draft) return;
    if (!editing && !isValidSlug(draft.id)) {
      setMsg({ kind: 'caution', text: 'The id must be lowercase letters, numbers, and dashes.' });
      return;
    }
    if (editing && !draft.source.host.trim()) {
      setMsg({ kind: 'caution', text: 'Enter the camera’s address.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    // Editing PUTs to the entry's existing id (never a new one), merging so stored fields the form
    // doesn't edit (capabilities, media, calibration) survive.
    const id = edit ? edit.id : draft.id;
    const body = edit ? mergeEdit(edit, draft) : toResourceBody(draft);
    saveCamera(id, body)
      .then(async () => {
        if (username || password) {
          // Best-effort: the camera saved even if storing the login is rejected; report honestly.
          await setCredentials(id, username, password).catch(() => {
            throw new ApiError('camera saved, but the login wasn’t stored', 0);
          });
        }
        onDone(true);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.message.startsWith('camera saved')) {
          setMsg({ kind: 'caution', text: err.message + ' — set it again from the list.' });
        } else {
          fail(err, 'save the camera');
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="wizard">
      <header className="page-head">
        <h1>{editing ? `Edit ${edit.name}` : 'Add a camera'}</h1>
        <div className="page-head__spacer" />
        <button type="button" className="btn btn--ghost" onClick={() => onDone(false)}>
          Cancel
        </button>
      </header>

      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}

      {step === 'scan' && (
        <div className="panel wizard__step">
          <p className="muted">Scan finds ONVIF cameras on the network — no address to type.</p>
          <div className="wizard__actions">
            <button type="button" className="btn" onClick={scan} disabled={busy}>
              {busy ? 'Scanning…' : 'Scan the network'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={manual}>
              Enter address manually
            </button>
          </div>
          {candidates && candidates.length === 0 && (
            <p className="muted">Nothing found. Add the camera manually, then try again.</p>
          )}
          {candidates && candidates.length > 0 && (
            <ul className="candidates">
              {candidates.map((c) => {
                const camera = isOnvifCandidate(c);
                return (
                  <li key={`${c.host}:${c.port ?? ''}`}>
                    <button
                      type="button"
                      className={`candidate${camera ? '' : ' candidate--other'}`}
                      onClick={() => pick(c)}
                    >
                      <span className="candidate__name">{c.name}</span>
                      <span className="mono candidate__addr">
                        {c.host}
                        {c.port ? `:${c.port}` : ''}
                      </span>
                      <span className={`chip chip--${camera ? 'info' : 'neutral'}`}>
                        {camera ? 'ONVIF camera' : 'other device'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {step === 'connect' && (
        <div className="panel wizard__step">
          <label className="field">
            <span>Address</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
            />
          </label>
          <label className="field">
            <span>ONVIF port</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="8000"
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>Camera username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              placeholder="the camera’s own login"
            />
          </label>
          <label className="field">
            <span>Camera password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="muted">
            This is the camera’s own login, used to read it and stored write-only — never the Signal
            K login, and never shown again.
          </p>
          <div className="wizard__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStep('scan')}>
              Back
            </button>
            <button type="button" className="btn" onClick={connect} disabled={busy}>
              {busy ? 'Reading…' : 'Connect & read'}
            </button>
          </div>
        </div>
      )}

      {step === 'details' && draft && (
        <div className="panel wizard__step">
          {!editing && (
            <p className="muted">
              Read from the camera: <b>{draft.name}</b> ·{' '}
              <span className="mono">
                {draft.source.scheme}://{draft.source.host}
                {draft.source.port ? `:${draft.source.port}` : ''}
                {draft.source.path ?? ''}
              </span>
            </p>
          )}
          <div className="caps">
            {capabilityBadges({ capabilities: draft.capabilities } as ICamera).map((b) => (
              <span key={b.key} className="chip chip--info" title={b.title}>
                {b.label}
              </span>
            ))}
            {draft.media?.codec && (
              <span className="chip chip--neutral">main: {codecLabel(draft.media.codec)}</span>
            )}
          </div>
          {draft.streams && draft.streams.length > 0 && (
            <ul className="streams">
              {draft.streams.map((s, i) => (
                <li key={i} className="mono">
                  {codecLabel(s.codec)}
                  {s.width && s.height ? ` · ${s.width}×${s.height}` : ''}
                </li>
              ))}
            </ul>
          )}
          {draft.media?.codec === 'h265' && draft.capabilities.substreams && (
            <p className="muted">
              The main stream is H.265, which most browsers can’t decode for live view — so the live
              view will use the camera’s H.264 sub-stream. The H.265 main still records.
            </p>
          )}
          {draft.media?.codec === 'h265' && !draft.capabilities.substreams && (
            <p className="muted">
              Heads up: the main stream is H.265 and no H.264 sub-stream was found, so live view may
              be blank in most browsers. It still records. Enable an H.264 sub-stream on the camera.
            </p>
          )}
          <label className="field">
            <span>Id</span>
            {/* The id is the resource key: editing keeps it fixed so a save can never mint a new camera. */}
            <input
              value={draft.id}
              disabled={editing}
              onChange={(e) => setDraft({ ...draft, id: slugify(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          {editing && (
            <>
              <label className="field">
                <span>Address</span>
                <input
                  value={draft.source.host}
                  onChange={(e) =>
                    setDraft({ ...draft, source: { ...draft.source, host: e.target.value } })
                  }
                  placeholder="192.168.1.100"
                />
              </label>
              <label className="field">
                <span>Port</span>
                <input
                  value={draft.source.port ?? ''}
                  inputMode="numeric"
                  onChange={(e) => {
                    const n = e.target.value === '' ? undefined : Number(e.target.value);
                    setDraft({
                      ...draft,
                      source: { ...draft.source, port: Number.isFinite(n) ? n : undefined },
                    });
                  }}
                />
              </label>
              <label className="field">
                <span>Stream path</span>
                <input
                  value={draft.source.path ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      source: { ...draft.source, path: e.target.value || undefined },
                    })
                  }
                  placeholder="/Preview_01_main"
                />
              </label>
            </>
          )}
          <label className="field">
            <span>Role</span>
            <select
              value={draft.role ?? ''}
              onChange={(e) => setDraft({ ...draft, role: (e.target.value || undefined) as Role })}
            >
              <option value="">—</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Mount</span>
            <select
              value={draft.mount ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, mount: (e.target.value || undefined) as Mount })
              }
            >
              <option value="">—</option>
              {MOUNTS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Bearing from bow (°)</span>
            <input
              value={draft.bearingRelativeDeg ?? ''}
              onChange={(e) => {
                const n = e.target.value === '' ? undefined : Number(e.target.value);
                setDraft({ ...draft, bearingRelativeDeg: Number.isFinite(n) ? n : undefined });
              }}
              inputMode="numeric"
              placeholder="0 = forward"
            />
          </label>
          {editing && (
            <>
              <label className="field cfg__check">
                <input
                  type="checkbox"
                  checked={draft.enabled !== false}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <label className="field">
                <span>New camera username</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  placeholder="leave blank to keep the current login"
                />
              </label>
              <label className="field">
                <span>New camera password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <p className="muted">
                {/* Presence only — the stored login is write-only and is never fetched or displayed. */}
                {hasStoredLogin
                  ? 'Login stored — write-only, never shown here. Fill these in only to replace it.'
                  : 'No login stored. Add one if the camera needs it.'}
              </p>
            </>
          )}
          <div className="wizard__actions">
            {!editing && (
              <button type="button" className="btn btn--ghost" onClick={() => setStep('connect')}>
                Back
              </button>
            )}
            <button type="button" className="btn" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Save camera'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
