import { useCallback, useEffect, useState } from 'react';
import {
  fetchCameras,
  getCredentialPresence,
  saveCamera,
  deleteCamera,
  ApiError,
  type ICameraEntry,
  type ICameraWrite,
} from '../api';
import { CameraWizard } from '../components/CameraWizard';
import { CameraHealth } from '../components/CameraHealth';
import { CalibrationWizard } from '../components/CalibrationWizard';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; cameras: ICameraEntry[] }
  | { state: 'error'; message: string };

type View =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'health'; id: string; name: string }
  | { kind: 'calibrate'; id: string; name: string };

interface Msg {
  kind: 'caution' | 'info';
  text: string;
}

/** Rebuild the resource body from an entry so a toggle re-PUTs the whole (validated) record. */
function bodyFrom(entry: ICameraEntry, enabled: boolean): ICameraWrite | null {
  if (!entry.source) return null;
  const body: ICameraWrite = { name: entry.name, enabled, source: entry.source };
  if (entry.placement) body.placement = entry.placement;
  if (entry.role) body.role = entry.role;
  if (entry.capabilities) body.capabilities = entry.capabilities;
  return body;
}

/**
 * The single source of truth for camera management: every camera the boat knows, with enable/disable,
 * delete, diagnostics, calibration, and the front door to zero-typing onboarding. Cameras are shared
 * Signal K resources, so a change here is reflected on every client.
 */
export function Cameras() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [creds, setCreds] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<View>({ kind: 'list' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  const refresh = useCallback(() => {
    const ctrl = new AbortController();
    fetchCameras(ctrl.signal)
      .then((cameras) => {
        setLoad({ state: 'ready', cameras });
        cameras.forEach((c) =>
          getCredentialPresence(c.id, ctrl.signal)
            .then((p) => setCreds((m) => ({ ...m, [c.id]: p.hasPassword })))
            .catch(() => undefined),
        );
      })
      .catch((err: unknown) =>
        setLoad({ state: 'error', message: err instanceof Error ? err.message : 'unreachable' }),
      );
    return () => ctrl.abort();
  }, []);

  useEffect(() => refresh(), [refresh]);

  const fail = (err: unknown, what: string): void => {
    setMsg({
      kind: 'caution',
      text:
        err instanceof ApiError && err.status === 401
          ? 'Sign in to Signal K to manage cameras.'
          : `Couldn’t ${what}.`,
    });
  };

  const toggle = (entry: ICameraEntry): void => {
    const body = bodyFrom(entry, !entry.enabled);
    if (!body) return;
    saveCamera(entry.id, body)
      .then(() => refresh())
      .catch((err: unknown) =>
        fail(err, entry.enabled ? 'disable the camera' : 'enable the camera'),
      );
  };

  const remove = (id: string): void => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    deleteCamera(id)
      .then(() => refresh())
      .catch((err: unknown) => fail(err, 'delete the camera'));
  };

  if (view.kind === 'add') {
    return (
      <CameraWizard
        onDone={(saved) => {
          setView({ kind: 'list' });
          if (saved) {
            setMsg({ kind: 'info', text: 'Camera added.' });
            refresh();
          }
        }}
      />
    );
  }
  if (view.kind === 'health') {
    return <CameraHealth id={view.id} name={view.name} onBack={() => setView({ kind: 'list' })} />;
  }
  if (view.kind === 'calibrate') {
    return (
      <CalibrationWizard
        id={view.id}
        name={view.name}
        onDone={(saved) => {
          setView({ kind: 'list' });
          if (saved) setMsg({ kind: 'info', text: 'Calibration saved.' });
        }}
      />
    );
  }

  return (
    <div className="cameras">
      <header className="page-head">
        <h1>Cameras</h1>
        <div className="page-head__spacer" />
        <button type="button" className="btn" onClick={() => setView({ kind: 'add' })}>
          Add a camera
        </button>
      </header>

      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}

      {load.state === 'loading' && <p className="muted">Loading cameras…</p>}
      {load.state === 'error' && (
        <p className="chip chip--caution">Can’t load cameras ({load.message})</p>
      )}
      {load.state === 'ready' && load.cameras.length === 0 && (
        <div className="empty">
          <p>No cameras yet.</p>
          <button type="button" className="btn" onClick={() => setView({ kind: 'add' })}>
            Add your first camera
          </button>
        </div>
      )}
      {load.state === 'ready' && load.cameras.length > 0 && (
        <ul className="camlist">
          {load.cameras.map((c) => (
            <li key={c.id} className="camrow">
              <div className="camrow__main">
                <span className="camrow__name">{c.name}</span>
                <span className="mono camrow__meta">
                  {c.role ?? '—'}
                  {c.placement?.mount ? ` · ${c.placement.mount}` : ''}
                  {c.source?.host ? ` · ${c.source.host}` : ''}
                </span>
              </div>
              <div className="camrow__chips">
                {c.capabilities?.absolutePtz && <span className="chip chip--neutral">PTZ</span>}
                {creds[c.id] && <span className="chip chip--neutral">login stored</span>}
                {!c.enabled && <span className="chip chip--caution">disabled</span>}
              </div>
              <div className="camrow__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setView({ kind: 'health', id: c.id, name: c.name })}
                >
                  Diagnostics
                </button>
                {c.capabilities?.absolutePtz && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setView({ kind: 'calibrate', id: c.id, name: c.name })}
                  >
                    Calibrate
                  </button>
                )}
                <button type="button" className="btn btn--ghost" onClick={() => toggle(c)}>
                  {c.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className={`btn btn--ghost${confirmId === c.id ? ' btn--danger' : ''}`}
                  onClick={() => remove(c.id)}
                  onBlur={() => confirmId === c.id && setConfirmId(null)}
                >
                  {confirmId === c.id ? 'Confirm delete' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
