import { useCallback, useEffect, useState } from 'react';
import {
  fetchIncidents,
  fetchIncident,
  incidentAssetUrl,
  setIncidentPinned,
  deleteIncident,
  ApiError,
  type IIncidentListItem,
  type IIncidentBundle,
  type IIncidentAsset,
  type TIncidentStatus,
} from '../api';
import { formatBytes } from '../lib/format';

interface Msg {
  kind: 'caution' | 'info';
  text: string;
}

const STATUS_TONE: Record<TIncidentStatus, string> = {
  complete: 'chip--info',
  partial: 'chip--caution',
  failed: 'chip--caution',
  capturing: 'chip--neutral',
};
const STATUS_LABEL: Record<TIncidentStatus, string> = {
  complete: 'Complete',
  partial: 'PARTIAL',
  failed: 'Failed',
  capturing: 'Capturing…',
};

function authMsg(err: unknown, what: string): Msg {
  if (err instanceof ApiError && err.status === 401) {
    return { kind: 'caution', text: 'Sign in to Signal K to manage incidents.' };
  }
  if (err instanceof ApiError && err.status === 409) {
    return { kind: 'caution', text: 'This incident is pinned — unpin it before deleting.' };
  }
  return { kind: 'caution', text: `Couldn’t ${what}.` };
}

function AssetRow({ id, asset }: { id: string; asset: IIncidentAsset }) {
  const [open, setOpen] = useState(false);
  const url = incidentAssetUrl(id, asset.id);
  const who = asset.cameraId ?? 'vessel';
  return (
    <li className="panel asset">
      <div className="asset__head">
        <div>
          <div className="asset__name">
            {asset.kind} · {who}
          </div>
          <div className="asset__meta mono">
            {formatBytes(asset.size)} · sha256 {asset.sha256.slice(0, 12)}…
            {asset.coverage && !asset.coverage.contiguous ? ' · spans a gap' : ''}
          </div>
        </div>
        {asset.kind === 'telemetry' ? (
          <button
            type="button"
            className="iconbtn iconbtn--wide"
            onClick={() => window.open(url, '_blank', 'noopener')}
          >
            Open
          </button>
        ) : (
          <button
            type="button"
            className="iconbtn iconbtn--wide"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide' : 'View'}
          </button>
        )}
      </div>
      {open && asset.kind === 'clip' && (
        <video className="vidrow__player" src={url} controls preload="metadata" />
      )}
      {open && asset.kind === 'snapshot' && <img className="vidrow__player" src={url} alt="" />}
    </li>
  );
}

/**
 * The Review cluster's Incidents tab: browse evidence bundles and review one. Honest throughout —
 * "best-effort evidence" not a certified VDR, PARTIAL surfaced (with the per-camera failures shown,
 * never hidden), sha256 = file-integrity not chain-of-custody, telemetry forward-only from the trigger.
 */
export function Incidents() {
  const [list, setList] = useState<IIncidentListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<IIncidentBundle | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    setErr(null);
    return fetchIncidents(signal)
      .then(setList)
      .catch((e: unknown) => {
        if (!signal?.aborted) setErr(e instanceof Error ? e.message : 'unreachable');
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const ctrl = new AbortController();
    setConfirmDel(false);
    fetchIncident(selected, ctrl.signal)
      .then(setDetail)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [selected]);

  const refreshDetail = async (id: string) => {
    const d = await fetchIncident(id).catch(() => null);
    if (d) setDetail(d);
  };

  const onPin = async (id: string, pinned: boolean) => {
    try {
      await setIncidentPinned(id, pinned);
      await Promise.all([load(), refreshDetail(id)]);
    } catch (e) {
      setMsg(authMsg(e, 'update the incident'));
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteIncident(id);
      setSelected(null);
      await load();
    } catch (e) {
      setMsg(authMsg(e, 'delete the incident'));
    } finally {
      setConfirmDel(false);
    }
  };

  // ---- Detail view ----
  if (selected && detail) {
    const offline = detail.failures.filter((f) => f.cameraId);
    return (
      <div className="settings">
        <header className="page-head">
          <button type="button" className="btn btn--ghost" onClick={() => setSelected(null)}>
            ‹ Incidents
          </button>
          <div>
            <h1>Incident</h1>
            <div className="page-head__sub">
              <span className={`chip ${STATUS_TONE[detail.status]}`}>
                {STATUS_LABEL[detail.status]}
              </span>{' '}
              best-effort evidence
            </div>
          </div>
          <div className="page-head__spacer" />
          <button
            type="button"
            className={`iconbtn iconbtn--wide${detail.pinned ? ' iconbtn--on' : ''}`}
            onClick={() => void onPin(detail.id, !detail.pinned)}
          >
            {detail.pinned ? 'Pinned' : 'Pin'}
          </button>
          {confirmDel ? (
            <button
              type="button"
              className="iconbtn iconbtn--wide btn--danger"
              onClick={() => void onDelete(detail.id)}
            >
              Confirm delete
            </button>
          ) : (
            <button
              type="button"
              className="iconbtn iconbtn--wide"
              onClick={() => setConfirmDel(true)}
            >
              Delete
            </button>
          )}
        </header>

        {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}

        <p className="muted">
          Cameras: {detail.cameras.join(', ') || '—'}. sha256 is a file-integrity check, not
          chain-of-custody. Telemetry is forward-only from the trigger — it doesn’t cover pre-roll.
        </p>

        {detail.failures.length > 0 && (
          <div className="chip chip--caution">
            PARTIAL — {detail.failures.length} capture
            {detail.failures.length === 1 ? '' : 's'} failed
            {offline.length > 0 ? ` (${offline.map((f) => f.cameraId).join(', ')})` : ''}
          </div>
        )}

        {detail.assets.length > 0 && (
          <ul className="vidlist">
            {detail.assets.map((a) => (
              <AssetRow key={a.id} id={detail.id} asset={a} />
            ))}
          </ul>
        )}

        {detail.failures.length > 0 && (
          <section className="panel">
            <h2 className="panel__title">What didn’t capture</h2>
            <ul className="rec__list">
              {detail.failures.map((f, i) => (
                <li key={i} className="rec__gap mono">
                  {f.kind} {f.cameraId ? `· ${f.cameraId}` : ''} — {f.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  // ---- List view ----
  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <h1>Incidents</h1>
          <div className="page-head__sub">Best-effort evidence bundles</div>
        </div>
      </header>
      <p className="muted">
        Evidence bundles from a manual “mark incident” or an auto-trigger — best-effort, never a
        certified VDR. PARTIAL bundles are shown as such, with the missing cameras named.
      </p>

      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}
      {err && <div className="chip chip--caution">Can’t load incidents ({err})</div>}
      {list && list.length === 0 && !err && (
        <div className="empty">
          <p>No incidents yet.</p>
          <p className="muted">Mark one from a camera or the Safety console.</p>
        </div>
      )}
      {list && list.length > 0 && (
        <ul className="vidlist">
          {list.map((inc) => (
            <li key={inc.id} className="panel vidrow">
              <button type="button" className="incident__row" onClick={() => setSelected(inc.id)}>
                <span className={`chip ${STATUS_TONE[inc.status]}`}>
                  {STATUS_LABEL[inc.status]}
                </span>
                <span className="vidrow__name">{new Date(inc.createdAt).toLocaleString()}</span>
                <span className="vidrow__meta mono">
                  {(inc.cameras ?? []).join(', ') || '—'}
                  {inc.failureCount ? ` · ${inc.failureCount} failed` : ''}
                  {inc.pinned ? ' · pinned' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
