import { useCallback, useEffect, useState } from 'react';
import {
  fetchCameras,
  fetchCamerasProjection,
  getCredentialPresence,
  saveCamera,
  deleteCamera,
  rescanCamera,
  ApiError,
  type ICameraEntry,
  type ICameraWrite,
  type IProjectedCamera,
} from '../api';
import { CameraWizard } from '../components/CameraWizard';
import { CameraHealth } from '../components/CameraHealth';
import { CalibrationWizard } from '../components/CalibrationWizard';
import { useWriteGate } from '../lib/auth';
import { capabilityBadges, healthPresence } from '../lib/camera';
import { mergeRescan } from '../lib/onboard';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; cameras: ICameraEntry[] }
  | { state: 'error'; message: string };

type View =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; entry: ICameraEntry }
  | { kind: 'health'; id: string; name: string }
  | { kind: 'calibrate'; entry: ICameraEntry };

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
  const [presence, setPresence] = useState<Record<string, IProjectedCamera['health']>>({});
  const [view, setView] = useState<View>({ kind: 'list' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rescanId, setRescanId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  // Read-only: camera management is a write, so disable it with a reason. Viewing + diagnostics stay.
  const gate = useWriteGate('Managing cameras needs write access — ask an admin.');

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
    // One aggregate read gives every row its health tri-state (producing / went dark / never seen).
    fetchCamerasProjection(ctrl.signal)
      .then((p) => setPresence(Object.fromEntries(p.cameras.map((c) => [c.id, c.health] as const))))
      .catch(() => undefined); // rows still render without presence chips
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

  // Re-introspect the camera (server-side, with its stored login), merge the fresh discovery into the
  // stored resource (preserving operator fields), and save — so it picks up newly-supported capabilities.
  const rescan = (entry: ICameraEntry): void => {
    setRescanId(entry.id);
    setMsg(null);
    rescanCamera(entry.id)
      .then((r) => saveCamera(entry.id, mergeRescan(entry, r)))
      .then(() => {
        setMsg({ kind: 'info', text: `Re-scanned ${entry.name} — capabilities refreshed.` });
        refresh();
      })
      .catch((err: unknown) => fail(err, 're-scan the camera'))
      .finally(() => setRescanId(null));
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
  if (view.kind === 'edit') {
    return (
      <CameraWizard
        edit={view.entry}
        hasStoredLogin={creds[view.entry.id] === true}
        onDone={(saved) => {
          setView({ kind: 'list' });
          if (saved) {
            setMsg({ kind: 'info', text: 'Camera updated.' });
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
        id={view.entry.id}
        name={view.entry.name}
        camera={view.entry}
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
        <button
          type="button"
          className="btn"
          onClick={() => setView({ kind: 'add' })}
          disabled={gate.disabled}
          title={gate.title}
        >
          Add a camera
        </button>
      </header>
      <p className="muted">
        Manage cameras here — every client (including KIP widgets) shares this list; a widget only
        picks which camera it shows.
      </p>

      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}

      {load.state === 'loading' && <p className="muted">Loading cameras…</p>}
      {load.state === 'error' && (
        <p className="chip chip--caution">Can’t load cameras ({load.message})</p>
      )}
      {load.state === 'ready' && load.cameras.length === 0 && (
        <div className="empty">
          <p>No cameras yet.</p>
          <button
            type="button"
            className="btn"
            onClick={() => setView({ kind: 'add' })}
            disabled={gate.disabled}
            title={gate.title}
          >
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
                {capabilityBadges(c).map((b) => (
                  <span key={b.key} className="chip chip--info" title={b.title}>
                    {b.label}
                  </span>
                ))}
                {creds[c.id] && <span className="chip chip--neutral">login stored</span>}
                {!c.enabled && <span className="chip chip--caution">disabled</span>}
                {c.enabled &&
                  presence[c.id] &&
                  (() => {
                    const p = healthPresence(presence[c.id]!);
                    return (
                      <span
                        className={`chip ${p.tone === 'caution' ? 'chip--caution' : 'chip--neutral'}`}
                      >
                        {p.tone === 'live' ? 'live' : p.label}
                      </span>
                    );
                  })()}
              </div>
              <div className="camrow__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setView({ kind: 'edit', entry: c })}
                  disabled={gate.disabled}
                  title={gate.title}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setView({ kind: 'health', id: c.id, name: c.name })}
                >
                  Diagnostics
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={gate.disabled || rescanId === c.id}
                  onClick={() => rescan(c)}
                  title={
                    gate.title ?? 'Re-detect this camera’s capabilities using its stored login'
                  }
                >
                  {rescanId === c.id ? 'Re-scanning…' : 'Re-scan'}
                </button>
                {c.capabilities?.absolutePtz && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setView({ kind: 'calibrate', entry: c })}
                    disabled={gate.disabled}
                    title={gate.title}
                  >
                    Calibrate
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => toggle(c)}
                  disabled={gate.disabled}
                  title={gate.title}
                >
                  {c.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className={`btn btn--ghost${confirmId === c.id ? ' btn--danger' : ''}`}
                  onClick={() => remove(c.id)}
                  onBlur={() => confirmId === c.id && setConfirmId(null)}
                  disabled={gate.disabled}
                  title={gate.title}
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
