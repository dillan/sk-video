import { useState } from 'react';
import {
  discoverCameras,
  introspectCamera,
  saveCamera,
  setCredentials,
  ApiError,
  type ICandidate,
} from '../api';
import {
  rankCandidates,
  isOnvifCandidate,
  draftFromIntrospect,
  toResourceBody,
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

/**
 * Zero-typing onboarding: scan the LAN, pick a discovered ONVIF camera (WSD noise like a NAS is ranked
 * down and clearly not-a-camera), enter the camera's write-only login, introspect to pre-fill the form,
 * then save. Credentials go to the ephemeral probe and the write-only store — never into the resource.
 */
export function CameraWizard({ onDone }: { onDone: (saved: boolean) => void }) {
  const [step, setStep] = useState<Step>('scan');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [candidates, setCandidates] = useState<ICandidate[] | null>(null);

  // connect step
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // details step
  const [draft, setDraft] = useState<ICameraDraft | null>(null);

  const fail = (err: unknown, what: string): void => {
    if (err instanceof ApiError && err.status === 401) {
      setMsg({ kind: 'caution', text: 'Sign in to Signal K to add a camera.' });
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
    if (!isValidSlug(draft.id)) {
      setMsg({ kind: 'caution', text: 'The id must be lowercase letters, numbers, and dashes.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    saveCamera(draft.id, toResourceBody(draft))
      .then(async () => {
        if (username || password) {
          // Best-effort: the camera saved even if storing the login is rejected; report honestly.
          await setCredentials(draft.id, username, password).catch(() => {
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
        <h1>Add a camera</h1>
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
          <p className="muted">
            Read from the camera: <b>{draft.name}</b> ·{' '}
            <span className="mono">
              {draft.source.scheme}://{draft.source.host}
              {draft.source.port ? `:${draft.source.port}` : ''}
              {draft.source.path ?? ''}
            </span>
          </p>
          <div className="caps">
            {draft.capabilities.absolutePtz && (
              <span className="chip chip--info">absolute PTZ</span>
            )}
            {draft.capabilities.ptz && !draft.capabilities.absolutePtz && (
              <span className="chip chip--info">PTZ</span>
            )}
            {draft.capabilities.audioBackchannel && (
              <span className="chip chip--info">two-way audio</span>
            )}
            {draft.media?.codec && (
              <span className="chip chip--neutral">main: {codecLabel(draft.media.codec)}</span>
            )}
            {draft.capabilities.substreams && (
              <span className="chip chip--info">H.264 sub-stream</span>
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
            <input
              value={draft.id}
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
          <div className="wizard__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStep('connect')}>
              Back
            </button>
            <button type="button" className="btn" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save camera'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
