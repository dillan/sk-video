import { useState } from 'react';
import {
  discoverCameras,
  introspectCamera,
  fetchOnboardingHints,
  testCamera,
  saveCamera,
  setCredentials,
  ApiError,
  type ICandidate,
  type ICamera,
  type ICameraEntry,
  type IDeviceHint,
  type ITestResult,
} from '../api';
import { capabilityBadges } from '../lib/camera';
import {
  rankCandidates,
  isOnvifCandidate,
  draftFromIntrospect,
  draftFromEntry,
  draftFromHint,
  parseStreamUrl,
  parseGeolocation,
  streamSchemeHints,
  plainStreamDraft,
  toResourceBody,
  mergeEdit,
  isValidSlug,
  slugify,
  MOUNTS,
  ROLES,
  type ICameraDraft,
  type IGeolocationFields,
  type Mount,
  type Role,
} from '../lib/onboard';
import { codecLabel } from '../lib/transport';

type Step = 'scan' | 'connect' | 'device' | 'guide' | 'stream' | 'details';
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

  // action-camera path (GoPro / Insta360): the curated hints + the one being walked through
  const [hints, setHints] = useState<IDeviceHint[] | null>(null);
  const [hint, setHint] = useState<IDeviceHint | null>(null);
  const [probe, setProbe] = useState<ITestResult | null>(null);

  // plain-stream path (a known rtsp:// URL, or an ONVIF-less camera)
  const [streamUrl, setStreamUrl] = useState('');
  const [hintText, setHintText] = useState('');
  const [credsFromUrl, setCredsFromUrl] = useState(false);
  // which step the details form returns to (each path enters details from a different place)
  const [returnStep, setReturnStep] = useState<Step>('connect');

  // details step
  const [draft, setDraft] = useState<ICameraDraft | null>(edit ? draftFromEntry(edit) : null);
  // Fixed-location fields are held as raw strings so a half-typed coordinate never trips validation;
  // they're parsed on save. Pre-filled when editing a camera that already has a geolocation.
  const [geo, setGeo] = useState<IGeolocationFields>(() => {
    const g = edit?.geolocation;
    return g
      ? {
          latitude: String(g.latitude),
          longitude: String(g.longitude),
          elevationM: g.elevationM !== undefined ? String(g.elevationM) : '',
          orientationDeg: g.orientationDeg !== undefined ? String(g.orientationDeg) : '',
        }
      : {};
  });
  const sensorOn = (s: string): boolean => draft?.capabilities.sensors?.includes(s) === true;
  const toggleSensor = (s: string, on: boolean): void => {
    if (!draft) return;
    const current = draft.capabilities.sensors ?? [];
    const sensors = on ? [...new Set([...current, s])] : current.filter((x) => x !== s);
    setDraft({ ...draft, capabilities: { ...draft.capabilities, sensors } });
  };

  const fail = (err: unknown, what: string): void => {
    if (err instanceof ApiError && err.status === 401) {
      setMsg({
        kind: 'caution',
        text: editing
          ? 'Sign in to Signal K to save the camera.'
          : 'Sign in to Signal K to add a camera.',
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

  // The action-camera path: these devices advertise no ONVIF and often live on their own WiFi AP,
  // so discovery can't find them — a curated walkthrough replaces the scan.
  const actionCamera = (): void => {
    setMsg(null);
    setStep('device');
    if (hints === null) {
      fetchOnboardingHints()
        .then(setHints)
        .catch((err: unknown) => fail(err, 'load the device guides'));
    }
  };

  const pickHint = (h: IDeviceHint): void => {
    setHint(h);
    setDraft(draftFromHint(h, h.sources[0] ?? null));
    setProbe(null);
    setMsg(null);
    setStep('guide');
  };

  const runProbe = (): void => {
    if (!draft || !draft.source.host.trim()) {
      setMsg({ kind: 'caution', text: 'Enter the stream address first.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    setProbe(null);
    testCamera({
      source: draft.source,
      username: username || undefined,
      password: password || undefined,
      hint: hintText || undefined,
    })
      .then(setProbe)
      .catch((err: unknown) => fail(err, 'test the stream'))
      .finally(() => setBusy(false));
  };

  // The plain-stream path: a camera without (working) ONVIF, or a known stream URL from the manual.
  const plainStream = (fromHost = ''): void => {
    setHint(null);
    setProbe(null);
    setStreamUrl('');
    setHintText('');
    setCredsFromUrl(false);
    setDraft(plainStreamDraft({ scheme: 'rtsp', host: fromHost }));
    setMsg(null);
    setStep('stream');
  };

  const pasteUrl = (raw: string): void => {
    setStreamUrl(raw);
    const parsed = parseStreamUrl(raw);
    if (!parsed) return;
    setDraft(plainStreamDraft(parsed.source));
    setProbe(null);
    // Credentials embedded in a URL are stripped here: they go to the write-only store at save,
    // never into the shared camera resource.
    if (parsed.username || parsed.password) {
      setUsername(parsed.username ?? '');
      setPassword(parsed.password ?? '');
      setCredsFromUrl(true);
    }
  };

  const applySuggestion = (paths: { main: string; sub?: string }): void => {
    if (!draft) return;
    setDraft({
      ...draft,
      source: { ...draft.source, path: paths.main },
      // A known vendor sub-stream rides along like introspection would record it.
      ...(paths.sub
        ? {
            capabilities: { ...draft.capabilities, substreams: true },
            media: { ...draft.media, substreamPath: paths.sub },
          }
        : {}),
    });
    setProbe(null); // the path changed — the previous probe result no longer applies
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
        setReturnStep('connect');
        setStep('details');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 502) {
          setMsg({
            kind: 'caution',
            text: 'Couldn’t reach or read that camera over ONVIF — check the login, or add it as a plain stream below.',
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
    const { geolocation, error: geoError } = parseGeolocation(geo);
    if (geoError) {
      setMsg({ kind: 'caution', text: geoError });
      return;
    }
    setBusy(true);
    setMsg(null);
    // Editing PUTs to the entry's existing id (never a new one), merging so stored fields the form
    // doesn't edit (capabilities, media, calibration) survive.
    const withGeo = { ...draft, geolocation };
    const id = edit ? edit.id : draft.id;
    const body = edit ? mergeEdit(edit, withGeo) : toResourceBody(withGeo);
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
          <p className="muted">
            A scan finds ONVIF cameras on the network — nothing to type. If yours isn’t found, add
            it by its address or set it up by hand.
          </p>
          <div className="wizard__actions">
            <button type="button" className="btn" onClick={scan} disabled={busy}>
              {busy ? 'Scanning…' : 'Scan the network'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={manual}>
              Enter the camera’s address
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => plainStream()}>
              Set it up manually
            </button>
            <button type="button" className="btn btn--ghost" onClick={actionCamera}>
              Action camera (GoPro / Insta360)
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

      {step === 'device' && (
        <div className="panel wizard__step">
          <p className="muted">
            Action cameras don’t announce themselves on the network (no ONVIF, usually their own
            WiFi), so a scan can’t find them. Pick yours and the wizard walks you through it — they
            work, but as <b>temporary</b> sources, not a permanent marine install.
          </p>
          {hints === null && <p className="muted">Loading device guides…</p>}
          {hints && (
            <ul className="candidates">
              {hints.map((h) => (
                <li key={h.key}>
                  <button type="button" className="candidate" onClick={() => pickHint(h)}>
                    <span className="candidate__name">{h.make}</span>
                    <span className="mono candidate__addr">{h.models.join(' · ')}</span>
                    <span className="chip chip--neutral">guided setup</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="wizard__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStep('scan')}>
              Back
            </button>
          </div>
        </div>
      )}

      {step === 'guide' && hint && draft && (
        <div className="panel wizard__step">
          <p className="muted">
            <b>
              {hint.make} {hint.models.join(' / ')}
            </b>
          </p>
          <ol className="wizard__walkthrough">
            {hint.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <label className="field">
            <span>Stream</span>
            <select
              value={draft.source.scheme}
              onChange={(e) =>
                setDraft({ ...draft, source: { ...draft.source, scheme: e.target.value } })
              }
            >
              <option value="rtsp">rtsp</option>
              <option value="rtmp">rtmp</option>
            </select>
          </label>
          <label className="field">
            <span>Address</span>
            <input
              value={draft.source.host}
              onChange={(e) =>
                setDraft({ ...draft, source: { ...draft.source, host: e.target.value } })
              }
              placeholder={hint.sources[0]?.host ?? 'your RTMP server’s address'}
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
              placeholder={String(streamSchemeHints(draft.source.scheme).defaultPort ?? '')}
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
              placeholder={hint.sources[0]?.path ?? '/gopro'}
            />
          </label>
          {probe && (
            <div className={`chip chip--${probe.ok ? 'info' : 'caution'}`}>
              {probe.ok ? (probe.message ?? 'Stream reachable.') : (probe.message ?? 'No stream.')}
            </div>
          )}
          <ul className="wizard__caveats muted">
            {hint.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <div className="wizard__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStep('device')}>
              Back
            </button>
            <button type="button" className="btn btn--ghost" onClick={runProbe} disabled={busy}>
              {busy ? 'Testing…' : 'Test the stream'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!draft.source.host.trim()}
              onClick={() => {
                setMsg(null);
                setReturnStep('guide');
                setStep('details');
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'stream' && draft && (
        <div className="panel wizard__step">
          <p className="muted">
            Set up a camera by hand — for anything without ONVIF. You’ll need its address and the
            link to its video stream (check the camera’s app or manual). Paste the whole link, or
            fill in the parts below, then test it before saving.
          </p>
          <label className="field">
            <span>Stream link</span>
            <input
              value={streamUrl}
              onChange={(e) => pasteUrl(e.target.value)}
              placeholder={streamSchemeHints(draft.source.scheme).urlExample}
              autoComplete="off"
            />
          </label>
          {credsFromUrl && (
            <p className="muted">
              The login embedded in that URL was moved to the fields below — it will be stored
              write-only, never in the shared camera record.
            </p>
          )}
          <label className="field">
            <span>Connection type</span>
            <select
              value={draft.source.scheme}
              onChange={(e) =>
                setDraft({ ...draft, source: { ...draft.source, scheme: e.target.value } })
              }
            >
              <option value="rtsp">RTSP — most IP &amp; security cameras</option>
              <option value="rtsps">RTSP, secure (rtsps)</option>
              <option value="rtmp">RTMP — streaming boxes &amp; some action cameras</option>
              <option value="http">HTTP — older or simple webcams (MJPEG)</option>
              <option value="https">HTTPS — secure webcam (MJPEG)</option>
            </select>
          </label>
          <label className="field">
            <span>Address</span>
            <input
              value={draft.source.host}
              onChange={(e) =>
                setDraft({ ...draft, source: { ...draft.source, host: e.target.value } })
              }
              placeholder="192.168.1.50"
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
              placeholder={String(streamSchemeHints(draft.source.scheme).defaultPort ?? '')}
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
              placeholder={streamSchemeHints(draft.source.scheme).pathPlaceholder}
            />
          </label>
          <label className="field">
            <span>Make / model (optional)</span>
            <input
              value={hintText}
              onChange={(e) => setHintText(e.target.value)}
              placeholder="e.g. Hikvision, Reolink, Dahua — suggests known stream paths"
            />
          </label>
          <label className="field">
            <span>Camera username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              placeholder="only if the stream needs one"
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
          {probe && (
            <div className={`chip chip--${probe.ok ? 'info' : 'caution'}`}>
              {probe.ok ? (probe.message ?? 'Stream reachable.') : (probe.message ?? 'No stream.')}
            </div>
          )}
          {probe?.suggestedPaths && (
            <p className="muted">
              Known {hintText || 'vendor'} paths:{' '}
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => applySuggestion(probe.suggestedPaths!)}
              >
                use {probe.suggestedPaths.main}
              </button>{' '}
              — then test again.
            </p>
          )}
          <div className="wizard__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStep('scan')}>
              Back
            </button>
            <button type="button" className="btn btn--ghost" onClick={runProbe} disabled={busy}>
              {busy ? 'Testing…' : 'Test the stream'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!draft.source.host.trim()}
              onClick={() => {
                setMsg(null);
                setReturnStep('stream');
                // Fields typed directly (no URL paste) leave the identity empty — default it from
                // the host so the details step never fails slug validation out of the gate.
                setDraft({
                  ...draft,
                  id: draft.id || slugify(draft.source.host),
                  name: draft.name || draft.source.host,
                });
                setStep('details');
              }}
            >
              Continue
            </button>
          </div>
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
            {/* The escape hatch for cameras without (working) ONVIF: same host, no introspection. */}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => plainStream(host.trim())}
            >
              No ONVIF? Add as a plain stream
            </button>
          </div>
        </div>
      )}

      {step === 'details' && draft && (
        <div className="panel wizard__step">
          {!editing && (
            <p className="muted">
              {returnStep === 'connect' ? 'Read from the camera' : 'Source'}: <b>{draft.name}</b> ·{' '}
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
              Heads up: the main stream is H.265 with no H.264 sub-stream. Browsers can’t decode
              H.265 for live view, so the server falls back to a still-refresh mode it has to
              software-transcode — heavy on a small device like a Pi. It still records fine. For
              smooth, low-CPU live view, enable an H.264 sub-stream on the camera.
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
          <label className="field cfg__check">
            <input
              type="checkbox"
              checked={sensorOn('bearing')}
              onChange={(e) => toggleSensor('bearing', e.target.checked)}
            />
            This camera reports its own compass bearing
          </label>
          <fieldset className="wizard__geo">
            <legend>Fixed location</legend>
            <p className="muted">
              For a camera that stays in one place — a shore station or a fixed dock camera. A
              camera on the boat moves with you, so leave this blank.
            </p>
            <label className="field">
              <span>Latitude</span>
              <input
                value={geo.latitude ?? ''}
                onChange={(e) => setGeo({ ...geo, latitude: e.target.value })}
                inputMode="decimal"
                placeholder="e.g. 37.8199"
              />
            </label>
            <label className="field">
              <span>Longitude</span>
              <input
                value={geo.longitude ?? ''}
                onChange={(e) => setGeo({ ...geo, longitude: e.target.value })}
                inputMode="decimal"
                placeholder="e.g. -122.4783"
              />
            </label>
            <label className="field">
              <span>Elevation (m)</span>
              <input
                value={geo.elevationM ?? ''}
                onChange={(e) => setGeo({ ...geo, elevationM: e.target.value })}
                inputMode="decimal"
                placeholder="optional"
              />
            </label>
            <label className="field">
              <span>Heading (°)</span>
              <input
                value={geo.orientationDeg ?? ''}
                onChange={(e) => setGeo({ ...geo, orientationDeg: e.target.value })}
                inputMode="numeric"
                placeholder="0 = north"
              />
            </label>
          </fieldset>
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
              <button type="button" className="btn btn--ghost" onClick={() => setStep(returnStep)}>
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
