import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  fetchVideos,
  uploadVideo,
  deleteVideo,
  videoUrl,
  ApiError,
  type IVideoAsset,
} from '../api';
import { formatBytes } from '../lib/format';

interface Msg {
  kind: 'caution' | 'info';
  text: string;
}

/** Honest, specific copy for the upload failure modes the server enforces. */
function uploadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Sign in to Signal K to upload a video.';
    if (err.status === 413) return 'That video would exceed the storage quota.';
    if (err.status === 415) return 'That file isn’t a recognised video format.';
  }
  return 'Couldn’t upload that video.';
}

/**
 * The Review cluster's "Imported" tab: surfaces the shipped /videos asset store (upload, list, inline
 * Range-served playback, delete) so a manually-kept clip lives alongside camera footage. It is honestly
 * separate from camera recordings and incidents, and quota-bounded server-side.
 */
export function ImportedVideos() {
  const [videos, setVideos] = useState<IVideoAsset[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback((signal?: AbortSignal) => {
    setErr(null);
    return fetchVideos(signal)
      .then(setVideos)
      .catch((e: unknown) => {
        if (!signal?.aborted) setErr(e instanceof Error ? e.message : 'unreachable');
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked after a failure
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      await uploadVideo(file);
      setMsg({ kind: 'info', text: `Uploaded ${file.name}.` });
      await load();
    } catch (uerr) {
      setMsg({ kind: 'caution', text: uploadError(uerr) });
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string): Promise<void> => {
    try {
      await deleteVideo(id);
      if (playing === id) setPlaying(null);
      await load();
    } catch (derr) {
      setMsg({
        kind: 'caution',
        text:
          derr instanceof ApiError && derr.status === 401
            ? 'Sign in to Signal K to delete a video.'
            : 'Couldn’t delete that video.',
      });
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <h1>Imported videos</h1>
          <div className="page-head__sub">Kept separate from camera footage</div>
        </div>
        <div className="page-head__spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Uploading…' : 'Upload video'}
        </button>
        <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
      </header>

      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}

      <p className="muted">
        Imported videos are stored separately from camera recordings and incidents, within a fixed
        quota. Other review tools (recordings, incidents, snapshots) arrive in later slices.
      </p>

      {err && <div className="chip chip--caution">Can’t load videos ({err})</div>}
      {videos && videos.length === 0 && !err && (
        <div className="empty">
          <p>No imported videos yet.</p>
          <p className="muted">Upload one to keep it alongside your camera footage.</p>
        </div>
      )}
      {videos && videos.length > 0 && (
        <ul className="vidlist">
          {videos.map((v) => (
            <li key={v.id} className="panel vidrow">
              <div className="vidrow__head">
                <div>
                  <div className="vidrow__name">{v.name}</div>
                  <div className="vidrow__meta mono">
                    {formatBytes(v.size)} · {new Date(v.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="dock__group">
                  <button
                    type="button"
                    className="iconbtn iconbtn--wide"
                    onClick={() => setPlaying(playing === v.id ? null : v.id)}
                  >
                    {playing === v.id ? 'Hide' : 'Play'}
                  </button>
                  {confirmId === v.id ? (
                    <button
                      type="button"
                      className="iconbtn iconbtn--wide btn--danger"
                      onClick={() => void onDelete(v.id)}
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="iconbtn iconbtn--wide"
                      onClick={() => setConfirmId(v.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {playing === v.id && (
                <video
                  className="vidrow__player"
                  src={videoUrl(v.id)}
                  controls
                  preload="metadata"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
