import { basename } from 'node:path';
import type { ISegment } from './recording-segments';

/**
 * The scrubbable-DVR-timeline contract the KIP Video widget consumes. The recorder writes fixed-length
 * MP4 segments whose only on-disk facts are a start time (mtime) and a byte size — it does not probe
 * each file's exact duration (that would mean reading every MP4 header on every list). So this pure
 * builder derives a best-effort timeline: each segment spans the nominal segment length, capped by the
 * start of the next segment, and a coverage GAP is emitted wherever consecutive segments are further
 * apart than that (a camera disconnect/reconnect). The currently-recording segment grows up to the
 * nominal length using `now`. Everything is epoch-ms and chronological, so the widget can lay out a
 * scrubber and seek to a segment via `GET /recordings/:name`. These types are the stable contract:
 * mirror them widget-side.
 */

export interface ITimelineSegment {
  /** The id for `GET /recordings/:name` (Range-playable). */
  name: string;
  /** Epoch ms the segment began. */
  startedAt: number;
  /** Best-effort span in ms (nominal segment length, capped to the next segment or `now`). */
  durationMs: number;
  bytes: number;
}

export interface ITimelineGap {
  /** Epoch ms where coverage stops. */
  startedAt: number;
  /** Epoch ms where coverage resumes. */
  endedAt: number;
  durationMs: number;
}

export interface ICameraTimeline {
  camera: string;
  /** Whether this camera is capturing right now (its last segment is still growing). */
  recording: boolean;
  /** Earliest covered instant (first segment start). */
  startedAt: number;
  /** Latest covered instant (last segment start + its duration). */
  endedAt: number;
  /** Segments oldest-first. */
  segments: ITimelineSegment[];
  /** Coverage gaps oldest-first. */
  gaps: ITimelineGap[];
}

export interface IRecordingTimeline {
  /** Epoch ms the timeline was built (the reference for an active segment's growing duration). */
  generatedAt: number;
  /** The nominal length the recorder targets per segment, in seconds. */
  segmentSeconds: number;
  /** One track per camera that has any stored segment, sorted by camera id. */
  cameras: ICameraTimeline[];
}

export interface IBuildTimelineOptions {
  now: number;
  activeCameras: string[];
  segmentSeconds: number;
  /** Slack (ms) absorbing segmenter jitter before a delta counts as a coverage gap. Default 2000. */
  gapToleranceMs?: number;
}

export function buildRecordingTimeline(
  segments: ISegment[],
  opts: IBuildTimelineOptions,
): IRecordingTimeline {
  const nominalMs = opts.segmentSeconds * 1000;
  const gapTolerance = opts.gapToleranceMs ?? 2000;
  const active = new Set(opts.activeCameras);

  const byCamera = new Map<string, ISegment[]>();
  for (const segment of segments) {
    const list = byCamera.get(segment.cameraId);
    if (list) {
      list.push(segment);
    } else {
      byCamera.set(segment.cameraId, [segment]);
    }
  }

  const cameras: ICameraTimeline[] = [];
  for (const [camera, list] of byCamera) {
    const ordered = [...list].sort((a, b) => a.startedAt - b.startedAt);
    const recording = active.has(camera);
    const tlSegments: ITimelineSegment[] = [];
    const gaps: ITimelineGap[] = [];

    for (let i = 0; i < ordered.length; i += 1) {
      const segment = ordered[i];
      const next = ordered[i + 1];
      let durationMs: number;
      if (next) {
        durationMs = Math.min(nominalMs, next.startedAt - segment.startedAt);
      } else if (recording) {
        // Still being written — it has grown for (now - start), but never past the nominal rollover.
        durationMs = Math.max(0, Math.min(nominalMs, opts.now - segment.startedAt));
      } else {
        durationMs = nominalMs; // a closed final segment of unknown exact length; nominal is the estimate
      }
      tlSegments.push({
        name: basename(segment.path),
        startedAt: segment.startedAt,
        durationMs,
        bytes: segment.bytes,
      });
      if (next) {
        const coveredEnd = segment.startedAt + durationMs;
        if (next.startedAt - coveredEnd > gapTolerance) {
          gaps.push({
            startedAt: coveredEnd,
            endedAt: next.startedAt,
            durationMs: next.startedAt - coveredEnd,
          });
        }
      }
    }

    const last = tlSegments[tlSegments.length - 1];
    cameras.push({
      camera,
      recording,
      startedAt: tlSegments[0].startedAt,
      endedAt: last.startedAt + last.durationMs,
      segments: tlSegments,
      gaps,
    });
  }

  cameras.sort((a, b) => (a.camera < b.camera ? -1 : a.camera > b.camera ? 1 : 0));
  return { generatedAt: opts.now, segmentSeconds: opts.segmentSeconds, cameras };
}
