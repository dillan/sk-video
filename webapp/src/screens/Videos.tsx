import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { fetchVideos, deleteVideo, videoUrl, ApiError, type IVideoAsset } from '../api';
import { formatBytes } from '../lib/format';
import { uploadVideoResumable } from '../lib/resumable-upload';
import { uploadAll, type IUploadHandle, type IUploadProgress } from '../lib/upload-queue';

/**
 * One video in the library grid: a muted inline <video> serves as both the still thumbnail
 * (its first frame, from preload="metadata") and the hover preview — mousing over it plays the
 * clip muted, leaving stops and rewinds. Clicking the thumbnail opens the full player; the red
 * trashcan (which never opens the player) asks for confirmation before deleting.
 */
function VideoTile({
  video,
  confirming,
  onPlay,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  video: IVideoAsset;
  confirming: boolean;
  onPlay: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const preview = (on: boolean): void => {
    const el = ref.current;
    if (!el) return;
    if (on) {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } else {
      el.pause();
      el.currentTime = 0;
    }
  };

  return (
    <li className="vidtile">
      <button
        type="button"
        className="vidtile__thumb"
        aria-label={`Play ${video.name}`}
        onClick={onPlay}
        onMouseEnter={() => preview(true)}
        onMouseLeave={() => preview(false)}
      >
        <video
          ref={ref}
          src={videoUrl(video.id)}
          muted
          loop
          playsInline
          preload="metadata"
          tabIndex={-1}
        />
        <span className="vidtile__play" aria-hidden="true">
          ▶
        </span>
      </button>
      <button
        type="button"
        className="vidtile__trash"
        aria-label={`Delete ${video.name}`}
        onClick={onAskDelete}
      >
        🗑
      </button>
      <div className="vidtile__label">
        <div className="vidtile__name" title={video.name}>
          {video.name}
        </div>
        <div className="vidtile__meta mono">
          {formatBytes(video.size)} · {new Date(video.createdAt).toLocaleDateString()}
        </div>
      </div>
      {confirming && (
        <div className="vidtile__confirm">
          <p>Delete this video?</p>
          <div className="vidtile__confirm-actions">
            <button type="button" className="iconbtn btn--danger" onClick={onConfirmDelete}>
              Confirm delete
            </button>
            <button type="button" className="iconbtn" onClick={onCancelDelete}>
              Keep
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

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

/** Compose the after-the-batch summary: honest about failures and cancellations. */
function summarize(files: IUploadProgress['files']): Msg {
  const done = files.filter((f) => f.state === 'done').length;
  const failed = files.filter((f) => f.state === 'failed').length;
  const cancelledCount = files.filter((f) => f.state === 'cancelled').length;
  const total = files.length;
  if (done === total) {
    return {
      kind: 'info',
      text: total === 1 ? `Uploaded ${files[0].name}.` : `Uploaded ${total} videos.`,
    };
  }
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} failed`);
  if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
  return {
    kind: failed > 0 ? 'caution' : 'info',
    text: `Uploaded ${done} of ${total} — ${parts.join(', ')}.`,
  };
}

/** "8.2 MB/s · ~40 s left" — shown once the queue has a measurable speed. */
function paceText(progress: IUploadProgress): string | null {
  if (progress.bytesPerSecond === null || progress.etaSeconds === null) return null;
  const eta =
    progress.etaSeconds < 90
      ? `~${Math.max(1, Math.round(progress.etaSeconds))} s left`
      : `~${Math.round(progress.etaSeconds / 60)} min left`;
  return `${formatBytes(progress.bytesPerSecond)}/s · ${eta}`;
}

function fileStateText(file: IUploadProgress['files'][number]): string {
  switch (file.state) {
    case 'queued':
      return 'Queued';
    case 'uploading':
      return `${Math.round(file.progress * 100)}%`;
    case 'done':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return file.error ?? 'Failed';
  }
}

/**
 * The Library cluster's Videos tab: upload your own video files (several at once, with live
 * progress, speed, and time remaining, and per-file cancel) and keep them alongside camera
 * footage. The shipped /videos asset store lists, Range-serves, and deletes them; every upload is
 * validated by magic bytes and bounded by a fixed storage quota server-side.
 */
export function Videos() {
  const [videos, setVideos] = useState<IVideoAsset[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [upload, setUpload] = useState<IUploadProgress | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<IUploadHandle | null>(null);
  /** The last batch's File objects, by row index — what a per-file Retry re-sends. */
  const batchFilesRef = useRef<File[]>([]);

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

  const startBatch = async (files: File[]): Promise<void> => {
    if (files.length === 0 || handleRef.current) return;
    setMsg(null);
    batchFilesRef.current = files;
    const handle = uploadAll(
      files,
      (file, onBytes, signal) => uploadVideoResumable(file, { onBytes, signal }),
      { onProgress: setUpload, errorText: uploadError },
    );
    handleRef.current = handle;
    const results = await handle.done;
    handleRef.current = null;
    // On a clean batch the panel has nothing left to say; with failures/cancellations it stays,
    // so the per-file reasons remain readable next to the summary (with a Retry per failed row).
    setUpload(
      results.every((f) => f.state === 'done')
        ? null
        : {
            files: results,
            currentIndex: null,
            bytesSent: 0,
            bytesTotal: 0,
            fraction: 1,
            bytesPerSecond: null,
            etaSeconds: null,
            done: true,
          },
    );
    setMsg(summarize(results));
    await load();
  };

  const onFiles = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // let the same files be re-picked after a failure
    void startBatch(files);
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
    void startBatch(Array.from(e.dataTransfer?.files ?? []));
  };

  const retryFile = (index: number): void => {
    const file = batchFilesRef.current[index];
    if (file) void startBatch([file]);
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

  const pct = upload ? Math.round(upload.fraction * 100) : 0;
  const pace = upload ? paceText(upload) : null;
  const uploading = upload !== null && !upload.done;

  return (
    <div
      className={`settings${dragOver ? ' droptarget' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="page-head">
        <div>
          <h1>Videos</h1>
          <div className="page-head__sub">Kept separate from camera footage</div>
        </div>
        <div className="page-head__spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : 'Upload videos'}
        </button>
        <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={onFiles} />
      </header>

      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}

      {upload && (
        <section className="panel upload">
          {!upload.done && (
            <div className="upload__head">
              <div
                className="upload__bar"
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div className="upload__bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="upload__stats mono">
                {pct}%{pace ? ` · ${pace}` : ''}
              </div>
              <button
                type="button"
                className="iconbtn"
                onClick={() => handleRef.current?.cancelAll()}
              >
                Cancel all
              </button>
            </div>
          )}
          <ul className="upload__files">
            {upload.files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="upload__file">
                <span className="upload__name">{f.name}</span>
                <span className="upload__meta mono">{formatBytes(f.size)}</span>
                <span
                  className={`upload__state${f.state === 'failed' ? ' upload__state--failed' : ''}`}
                >
                  {fileStateText(f)}
                </span>
                {(f.state === 'queued' || f.state === 'uploading') && (
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={`Cancel ${f.name}`}
                    onClick={() => handleRef.current?.cancelFile(i)}
                  >
                    ✕
                  </button>
                )}
                {upload.done && (f.state === 'failed' || f.state === 'cancelled') && (
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={`Retry ${f.name}`}
                    onClick={() => retryFile(i)}
                  >
                    Retry {f.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="muted">
        Videos are files you upload yourself (pick several, or drag &amp; drop them here) — kept
        separate from the DVR recordings and incident evidence your cameras produce, and bounded by
        a fixed storage quota. An upload interrupted by a dropped connection resumes where it left
        off.
      </p>

      {err && <div className="chip chip--caution">Can’t load videos ({err})</div>}
      {videos && videos.length === 0 && !err && (
        <div className="empty">
          <p>No videos yet.</p>
          <p className="muted">Upload one to keep it alongside your camera footage.</p>
        </div>
      )}
      {videos && videos.length > 0 && (
        <ul className="vidgrid">
          {videos.map((v) => (
            <VideoTile
              key={v.id}
              video={v}
              confirming={confirmId === v.id}
              onPlay={() => setPlaying(v.id)}
              onAskDelete={() => setConfirmId(v.id)}
              onConfirmDelete={() => void onDelete(v.id)}
              onCancelDelete={() => setConfirmId(null)}
            />
          ))}
        </ul>
      )}

      {playing && (
        <div
          className="vidmodal"
          role="dialog"
          aria-modal="true"
          aria-label="Video player"
          onClick={() => setPlaying(null)}
        >
          <button
            type="button"
            className="vidmodal__close iconbtn"
            aria-label="Close player"
            onClick={() => setPlaying(null)}
          >
            ✕
          </button>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div className="vidmodal__stage" onClick={(e) => e.stopPropagation()}>
            <video
              className="vidmodal__player"
              src={videoUrl(playing)}
              controls
              autoPlay
              preload="metadata"
            />
          </div>
        </div>
      )}
    </div>
  );
}
