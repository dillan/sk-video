import type { Plugin, ServerAPI } from '@signalk/server-api';
import type { IRouter, Request, Response } from 'express';
import { promises as dns } from 'node:dns';
import { CameraStore } from './cameras/camera-store';
import { CredentialStore } from './cameras/credential-store';
import { FileCameraPersistence, FileCredentialPersistence } from './cameras/file-persistence';
import { createCameraResourceMethods } from './cameras/resource-provider';
import { registerLayoutRoute } from './cameras/layout-routes';
import { validateCamera, sourceEndpointChanged } from './cameras/camera-validation';
import { assertHostAllowed, type ISsrfOptions } from './security/ssrf-guard';
import { redactUrl } from './security/redact';
import { RateLimiter } from './security/rate-limit';
import { withTimeout } from './security/with-timeout';
import { Go2rtcBinaryManager } from './gateway/go2rtc-binary-manager';
import { Go2rtcProcess } from './gateway/go2rtc-process';
import { Go2rtcGateway } from './gateway/go2rtc-gateway';
import { registerProxyRoutes } from './gateway/go2rtc-proxy-routes';
import { StreamWatchdog } from './gateway/stream-watchdog';
import { fetchStreamHealth } from './gateway/stream-health';
import { PtzManager } from './onvif/ptz-manager';
import { registerPtzRoutes } from './onvif/ptz-routes';
import { registerImagingRoutes } from './onvif/imaging-routes';
import { DiscoveryService } from './discovery/discovery-service';
import { createWsDiscoveryProbe } from './discovery/ws-discovery-probe';
import { createMdnsProbe } from './discovery/mdns-probe';
import { createSsdpProbe } from './discovery/ssdp-probe';
import { registerDiscoveryRoutes } from './discovery/discovery-routes';
import { registerIntrospectRoute } from './discovery/introspect-routes';
import { registerOnboardingHintsRoute } from './discovery/device-hints';
import { introspectOnvifCamera } from './onvif/onvif-introspect';
import { MobController } from './safety/mob-controller';
import { toMobCamera, ownShipFromSelfState, findMobBeacon } from './safety/mob-wiring';
import { MobVisualRefine, frigatePersonDetection } from './safety/mob-visual-refine';
import { WatchAutomation } from './safety/watch-automation';
import { registerSlewRoutes } from './awareness/slew-routes';
import { slewOwnShipFromSelfState } from './awareness/slew-wiring';
import { parseAisTargets } from './awareness/ais-targets';
import { AssetStore } from './uploads/asset-store';
import {
  createFileAssetStore,
  FileAssetIndexPersistence,
  FileBlobStore,
} from './uploads/file-asset-store';
import { FrigateClient } from './analytics/frigate-client';
import { FRIGATE_EVENT_TOPIC, frigateSlug, parseFrigateEvent } from './analytics/frigate-events';
import { connectFrigateMqtt, type IMqttConnection } from './analytics/frigate-mqtt';
import { registerFrigateClipRoutes } from './analytics/frigate-clip-routes';
import { fetchFrigateClip } from './analytics/frigate-clip-fetch';
import { cacheFrigateClip } from './analytics/frigate-clip-cache';
import { registerUploadRoutes } from './uploads/upload-routes';
import { registerTestRoutes } from './diagnostics/test-routes';
import { runFfprobe, tcpProbe } from './diagnostics/probe-runner';
import {
  detectHardware,
  describeTier,
  TIER_ORDER,
  type THardwareTier,
  type IHardwareInfo,
} from './hardware/tier-detect';
import { SignalKBridge, type ISignalKApp, type AlarmState } from './signalk/sk-bridge';
import { SnapshotService } from './recording/snapshot-service';
import { FileSnapshotStore } from './recording/file-snapshot-store';
import { RecordingManager } from './recording/recording-manager';
import { registerRecordingRoutes } from './recording/recording-routes';
import { scanRecordings } from './recording/file-recordings';
import { FileIncidentStore } from './incidents/incident-store';
import { IncidentController } from './incidents/incident-controller';
import { createIncidentResourceMethods } from './incidents/incident-resource-provider';
import { registerIncidentRoutes } from './incidents/incident-routes';
import { createFfmpegClipProducer } from './incidents/ffmpeg-clip-producer';
import {
  shouldTrigger,
  DEFAULT_TRIGGER_STATES,
  type ITriggerState,
} from './incidents/trigger-decision';
import { bundlesToPrune, type IBundleQuota } from './incidents/retention';
import { validateTriggerRequest } from './incidents/incident-validation';
import { go2rtcApiUrl } from './gateway/go2rtc-proxy';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile as fsReadFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUGIN_ID = 'sk-video';
const SYNC_DEBOUNCE_MS = 500;
const DNS_TIMEOUT_MS = 5000;
// Brute-force / enumeration guard for the credential and connection-test endpoints.
const SENSITIVE_MAX_PER_MINUTE = 20;
// DVR retention: a global budget across all cameras' segments, pruned oldest-first so a full disk
// can never brick the Signal K server. Conservative defaults; tier/quota tuning is future work.
const RECORDING_SEGMENT_SECONDS = 60;
const RECORDING_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB
const RECORDING_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
const RECORDING_SWEEP_MS = 5 * 60 * 1000; // prune every 5 minutes
// Snapshot retention: bound growth so MOB/anchor/incident captures can't fill the disk over months.
const SNAPSHOT_MAX_COUNT = 2000;
const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Incident bundles: pre/post-roll clip + telemetry track + snapshots around an event.
const INCIDENT_DEFAULT_PRE_MS = 15_000;
const INCIDENT_DEFAULT_POST_MS = 15_000;
const INCIDENT_SAMPLE_INTERVAL_MS = 2000;
// Give the DVR a moment to close the segment covering the end of the post-roll before cutting.
const INCIDENT_FINALIZE_GRACE_MS = 2000;
// One auto-triggered bundle per notification path per minute, so a flapping alarm can't spam.
const INCIDENT_TRIGGER_COOLDOWN_MS = 60_000;
const INCIDENT_SWEEP_MS = 5 * 60 * 1000;
// Safety-camera watchdog: poll go2rtc health this often; the hysteresis thresholds turn that into a
// ~45 s debounce before a "camera dark" alarm (and ~30 s before it clears).
const WATCHDOG_POLL_MS = 15_000;
const VISUAL_REFINE_CHECK_MS = 1000; // how often the experimental MOB refine checks for track loss
// A retention budget for the incidents subtree, independent of the DVR/upload budgets. Pinned
// bundles are never pruned.
const INCIDENT_QUOTA: IBundleQuota = {
  maxBytes: 5 * 1024 * 1024 * 1024, // 5 GiB
  maxCount: 200,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};
const ALARM_STATES = ['alert', 'alarm', 'emergency'];
/** Coerce an untrusted notification state string into a valid alarm state for the consolidated alert. */
function asAlarmState(value: unknown): AlarmState {
  return typeof value === 'string' && ALARM_STATES.includes(value)
    ? (value as AlarmState)
    : 'alarm';
}
// Frigate interop (consume a user-run Frigate; never bundled). Clips are short — cap size/quota.
// Event clips are a few-to-tens of MiB; this bounds the in-memory fetch so a burst can't OOM a Pi.
const FRIGATE_CLIP_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB per clip
const FRIGATE_FETCH_TIMEOUT_MS = 15_000;
const FRIGATE_CLIP_LIMITS = {
  maxFileBytes: FRIGATE_CLIP_MAX_BYTES,
  maxTotalBytes: 2 * 1024 * 1024 * 1024, // 2 GiB of cached clips
  maxFileCount: 200,
};
// Expire a quiet Frigate alert (and its bridge notification) even if no further events arrive.
const FRIGATE_SWEEP_MS = 5 * 60 * 1000;
function csvList(value: string | undefined, fallback: string[]): string[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export = function (app: ServerAPI): Plugin {
  let cameras: CameraStore | null = null;
  let credentials: CredentialStore | null = null;
  let gateway: Go2rtcGateway | null = null;
  let ptz: PtzManager | null = null;
  let discovery: DiscoveryService | null = null;
  let videos: AssetStore | null = null;
  let hardware: IHardwareInfo | null = null;
  let bridge: SignalKBridge | null = null;
  let snapshots: SnapshotService | null = null;
  let recordings: RecordingManager | null = null;
  let recordingsDir: string | null = null;
  let recordingSweep: ReturnType<typeof setInterval> | null = null;
  let incidents: IncidentController | null = null;
  let incidentStore: FileIncidentStore | null = null;
  let incidentSweep: ReturnType<typeof setInterval> | null = null;
  let incidentUnsub: (() => void) | null = null;
  let incidentClipTmpDir: string | null = null;
  let watch: WatchAutomation | null = null;
  let watchUnsub: (() => void) | null = null;
  let watchdog: StreamWatchdog | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let frigateClient: FrigateClient | null = null;
  let frigateMqtt: IMqttConnection | null = null;
  let frigateClips: AssetStore | null = null;
  let frigatePruneTimer: ReturnType<typeof setInterval> | null = null;
  const triggerState: ITriggerState = { lastFiredAtByKey: {} };
  // Cameras this MOB event started recording, so deactivation stops exactly those (and not a
  // camera the operator was already manually recording).
  let mobRecording: string[] = [];
  let mob: MobController | null = null;
  let visualRefine: MobVisualRefine | null = null;
  let visualRefineTimer: ReturnType<typeof setInterval> | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncInFlight: Promise<void> | null = null;
  let syncRerun = false;

  const ssrfOptions: ISsrfOptions = { allowPrivate: true };
  // Cap DNS resolution so an unresponsive resolver on a flaky boat network can't stall the plugin.
  const lookup = async (host: string): Promise<string[]> => {
    const records = await withTimeout(
      dns.lookup(host, { all: true }),
      DNS_TIMEOUT_MS,
      'DNS lookup timed out',
    );
    return records.map((a) => a.address);
  };
  const log = (msg: string) => app.debug?.(redactUrl(msg));
  /** Read a path from the full data model, tolerating servers/versions that don't expose getPath. */
  const safeGetPath = (path: string): unknown => {
    try {
      return app.getPath?.(path);
    } catch {
      return undefined;
    }
  };

  // One limiter shared by the brute-force-able routes, keyed by client address.
  const limiter = new RateLimiter({ max: SENSITIVE_MAX_PER_MINUTE, windowMs: 60_000 });
  const clientKey = (req: Request): string => req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const rateLimit = (req: Request) => limiter.check(clientKey(req));
  /** Writes a 429 and returns true when the caller is over the limit. */
  const tooManyRequests = (req: Request, res: Response): boolean => {
    const result = rateLimit(req);
    if (!result.ok) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(429).json({ error: 'too many requests', retryAfterMs: result.retryAfterMs });
      return true;
    }
    return false;
  };

  async function runSync(): Promise<void> {
    // Serialize reconciles: a sync that arrives while one is running coalesces into a single re-run
    // afterwards, so two overlapping syncs can never drive the gateway (and go2rtc spawn) concurrently.
    if (syncInFlight) {
      syncRerun = true;
      return syncInFlight;
    }
    syncInFlight = (async () => {
      do {
        syncRerun = false;
        if (!gateway || !cameras || !credentials) {
          break;
        }
        try {
          await gateway.sync(cameras.list(), credentials.all());
        } catch (err) {
          app.setPluginError(
            redactUrl(`Gateway error: ${err instanceof Error ? err.message : String(err)}`),
          );
        }
      } while (syncRerun);
    })().finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  }

  /** Coalesce rapid camera/credential changes into a single gateway reconcile. */
  function scheduleSync(): void {
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(() => void runSync(), SYNC_DEBOUNCE_MS);
  }

  // A1 (experimental): turn one Frigate person detection into a small bounded relativeMove nudge on
  // top of MOB's authoritative geo-pointing. Only runs while MOB is active AND the refine is engaged.
  // The Frigate camera NAME is matched to the sk-video camera id (operators give the camera the same
  // id as its Frigate name); we only nudge a camera the MOB controller is already geo-aiming — i.e. one
  // with absolute PTZ — so the authoritative baseline keeps re-asserting underneath the correction.
  // frigatePersonDetection applies the honesty filters (skip 'end'/false-positive, finite score, a
  // normalised box). An unmatched camera is a safe no-op: geo-pointing simply stays in control.
  function feedVisualRefine(payload: unknown): void {
    if (!visualRefine?.isActive() || mob?.isActive() !== true) {
      return;
    }
    const msg = parseFrigateEvent(payload);
    if (!msg) {
      return;
    }
    const found = frigatePersonDetection(msg);
    if (!found) {
      return;
    }
    // Only refine a camera the MOB controller is ACTUALLY geo-aiming — which requires BOTH absolute PTZ
    // AND calibration (computeAim returns null without calibration). Without that baseline underneath,
    // a relativeMove nudge would drift an uncalibrated camera with nothing re-centring it, breaking the
    // "never replaces geo-pointing" promise. An uncalibrated/non-PTZ camera is a safe no-op here.
    const cam = cameras?.get(found.camera);
    if (cam?.capabilities?.absolutePtz !== true || !cam.calibration) {
      return;
    }
    const correction = visualRefine.onDetection(found.detection);
    if (correction) {
      void ptz
        ?.controllerFor(found.camera)
        .then((controller) =>
          controller.moveRelative({ pan: correction.pan, tilt: correction.tilt }),
        )
        .catch(() => undefined);
    }
  }

  const plugin: Plugin = {
    id: PLUGIN_ID,
    name: 'SK Video',
    description: 'IP cameras for the browser: gateway, ONVIF PTZ, discovery and uploads.',

    schema: () => ({
      type: 'object',
      properties: {
        hardwareTier: {
          type: 'string',
          title: 'Hardware tier (override)',
          description:
            'Leave on Auto-detect unless the detected tier is wrong. Controls which heavier features (recording, hardware snapshots, on-device analytics) are offered.',
          enum: ['auto', ...TIER_ORDER],
          default: 'auto',
        },
        autoTriggerPath: {
          type: 'string',
          title: 'Incident auto-trigger path (optional)',
          description:
            'Signal K notification subtree to auto-capture an incident bundle from (e.g. "notifications.*"). Leave blank to disable — the manual "mark incident" trigger is the reliable path. Auto-triggers fire only on alert/alarm/emergency and are best-effort.',
          default: '',
        },
        anchorWatchPath: {
          type: 'string',
          title: 'Anchor/geofence watch path',
          description:
            'Signal K notification path to watch for an anchor-drag or geofence alarm. On an alarm it auto-captures evidence on your anchor/security-role cameras and raises one consolidated notification. It consumes an alarm you already produce (Anchor API / another plugin) — it does not compute drag itself. Default "notifications.navigation.anchor"; blank to disable.',
          default: 'notifications.navigation.anchor',
        },
        frigateMqttUrl: {
          type: 'string',
          title: 'Frigate MQTT broker URL (optional)',
          description:
            'Connect to a YOUR-OWN-Frigate MQTT broker (e.g. "mqtt://user:pass@192.168.1.10:1883") to surface its person/car/boat detections as Signal K notifications + cached clips. Frigate is never bundled and runs on your own hardware; detection is close-range COCO-class only — never hazard/MOB-at-distance. Blank to disable.',
          default: '',
        },
        frigateApiUrl: {
          type: 'string',
          title: 'Frigate HTTP API URL (optional)',
          description:
            'Frigate HTTP API base (e.g. "http://192.168.1.10:5000") used to fetch the event clip when a detection ends. The host is SSRF-guarded. Blank = notifications only, no clip caching.',
          default: '',
        },
        frigateLabels: {
          type: 'string',
          title: 'Frigate alert labels',
          description:
            'Comma-separated object labels that count as an intrusion. Default "person,car".',
          default: 'person,car',
        },
        frigateMinScore: {
          type: 'number',
          title: 'Frigate minimum score',
          description: 'Minimum detection score (0–1) to alert on.',
          default: 0.7,
          minimum: 0,
          maximum: 1,
        },
        frigateZones: {
          type: 'string',
          title: 'Frigate zones (optional)',
          description: 'Comma-separated Frigate zones an object must enter to alert; blank = any.',
          default: '',
        },
        mobVisualRefine: {
          type: 'boolean',
          title: 'Experimental visual MOB refine (NOT safety-rated)',
          description:
            'When ON, during a man-overboard event a Frigate person detection adds a small, bounded visual correction on TOP of the authoritative position-based aim. It fails safe — on track loss it notifies and reverts to position-based aim. It can lock onto a wake/whitecap and cannot hold a tiny person on open water; it never replaces the geo-pointing baseline and makes no safety claim. Requires Frigate configured above, and only refines a PTZ camera whose id here matches its Frigate camera name. OFF by default.',
          default: false,
        },
      },
    }),

    start(options?: {
      hardwareTier?: string;
      autoTriggerPath?: string;
      anchorWatchPath?: string;
      frigateMqttUrl?: string;
      frigateApiUrl?: string;
      frigateLabels?: string;
      frigateMinScore?: number;
      frigateZones?: string;
      mobVisualRefine?: boolean;
    }) {
      try {
        const dataDir = app.getDataDirPath();
        const override =
          options?.hardwareTier && options.hardwareTier !== 'auto'
            ? (options.hardwareTier as THardwareTier)
            : undefined;
        hardware = detectHardware({ override });
        cameras = new CameraStore(new FileCameraPersistence(dataDir));
        credentials = new CredentialStore(new FileCredentialPersistence(dataDir));
        gateway = new Go2rtcGateway({
          dataDir,
          binary: new Go2rtcBinaryManager({ dataDir, log }),
          process: new Go2rtcProcess(log),
        });
        ptz = new PtzManager({
          getCamera: (id) => cameras?.get(id) ?? null,
          getCredentials: (id) => credentials?.get(id) ?? null,
          assertHostAllowed: (host) => assertHostAllowed(host, ssrfOptions, lookup),
        });
        discovery = new DiscoveryService({
          probes: [createWsDiscoveryProbe(), createMdnsProbe(), createSsdpProbe()],
        });
        videos = createFileAssetStore(dataDir);

        // The Signal K bridge speaks plain Signal K JSON; the server's branded delta/notification
        // types are a structural superset, so we adapt at this single boundary.
        bridge = new SignalKBridge(app as unknown as ISignalKApp, PLUGIN_ID);
        snapshots = new SnapshotService({
          capture: async (id: string) => {
            const upstream = await fetch(go2rtcApiUrl(gateway?.apiPort ?? 1984, 'frame', id));
            if (!upstream.ok) {
              throw new Error(`frame fetch failed (${upstream.status})`);
            }
            return new Uint8Array(await upstream.arrayBuffer());
          },
          selfSource: bridge,
          store: new FileSnapshotStore(dataDir, 'snapshots', {
            maxCount: SNAPSHOT_MAX_COUNT,
            maxAgeMs: SNAPSHOT_MAX_AGE_MS,
          }),
        });

        // DVR: per-camera ffmpeg recorders remux go2rtc's loopback RTSP restream into rotating MP4
        // segments. Channel-capped to the hardware tier and pruned to a byte/age budget. Credentials
        // live only in go2rtc's source config — the recorder reads the unauthenticated loopback
        // restream, so no secret ever lands in a segment path or filename.
        recordingsDir = join(dataDir, 'recordings');
        // ffmpeg's segment muxer does NOT create its output directory, so the very first recording
        // on a fresh install would fail silently — create it up front.
        mkdirSync(recordingsDir, { recursive: true });
        recordings = new RecordingManager({
          dir: recordingsDir,
          rtspBase: () => `rtsp://127.0.0.1:${gateway?.rtspPort ?? 8554}`,
          spawnRecorder: (args) => {
            const child = spawn('ffmpeg', args, { stdio: 'ignore' });
            child.on('error', (err) =>
              app.error?.(`[sk-video] recorder failed: ${redactUrl(err.message)}`),
            );
            return { stop: () => child.kill('SIGINT') };
          },
          maxChannels: () => hardware?.capabilities.maxRecordingChannels ?? 0,
          limits: () => ({ maxBytes: RECORDING_MAX_BYTES, maxAgeMs: RECORDING_MAX_AGE_MS }),
          listSegments: () => (recordingsDir ? scanRecordings(recordingsDir) : []),
          removeFile: (path) => rmSync(path, { force: true }),
          segmentSeconds: RECORDING_SEGMENT_SECONDS,
        });
        recordingSweep = setInterval(() => {
          try {
            recordings?.sweep(Date.now());
          } catch {
            // a transient FS error during prune must not crash the plugin; next sweep retries
          }
        }, RECORDING_SWEEP_MS);
        recordingSweep.unref?.();

        // Man-overboard: aim every capable PTZ camera at the MOB position (live beacon, else the
        // dead-reckoned datum), recomputed as the boat drifts. Aids — never replaces — MOB procedure.
        mob = new MobController({
          getOwnShip: () => (bridge ? ownShipFromSelfState(bridge.getSelfState()) : null),
          getBeaconTarget: () => findMobBeacon(safeGetPath('vessels')),
          getCameras: () =>
            Object.entries(cameras?.list() ?? {})
              .filter(([, camera]) => camera.enabled)
              .map(([id, camera]) => toMobCamera(id, camera)),
          aimCamera: (id, pan, tilt) => {
            void ptz
              ?.controllerFor(id)
              .then((controller) => controller.moveAbsolute({ pan, tilt }))
              // Surface a flaky PTZ camera rejecting the MOB aim rather than swallowing it silently —
              // the operator-facing aimedCameras count is best-effort and this is the failure trail.
              .catch((err: unknown) =>
                log(
                  `mob aim failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
          },
          raiseNotification: (message, position) =>
            void bridge?.raiseNotification('mob', {
              state: 'emergency',
              message,
              ...(position ? { data: { position } } : {}),
            }),
          clearNotification: () => void bridge?.clearNotification('mob'),
          emitMarker: (target) =>
            void bridge?.emit({ path: 'navigation.mob.position', value: target }),
          snapshotAll: () => {
            for (const id of Object.keys(cameras?.list() ?? {})) {
              void snapshots?.capture(id).catch(() => undefined);
            }
          },
          recordCameras: (ids) => {
            // Only track cameras THIS MOB event newly started — never a recording the operator already
            // had running manually, or deactivating MOB would stop their recording out from under them.
            mobRecording = ids.filter(
              (id) => recordings?.isRecording(id) !== true && recordings?.start(id) === true,
            );
          },
          stopRecording: () => {
            for (const id of mobRecording) {
              recordings?.stop(id);
            }
            mobRecording = [];
          },
          log,
        });

        // A Signal K PUT action so any client (a KIP button, a mapped hardware key) can trigger MOB.
        bridge.registerAction('cameras.mob.activate', (value) => {
          if (value === false) {
            mob?.deactivate();
            visualRefine?.deactivate();
          } else {
            mob?.activate();
            visualRefine?.activate();
          }
          return { state: 'COMPLETED', statusCode: 200 };
        });

        // Incident bundles: on a trigger, cut a pre/post-roll clip per camera from the DVR segments,
        // package them with a sampled telemetry track + stamped snapshots into one atomic bundle.
        // bridge/snapshots are non-null here; capture locals so the closures never null-check.
        const skBridge = bridge;
        const snapshotService = snapshots;
        const recDir = recordingsDir; // capture: stop() nulls the module var, but an in-flight
        // finalize must still scan on-disk segments rather than silently drop the clip.
        incidentStore = new FileIncidentStore(dataDir);
        incidentStore.sweepStaging(); // drop any staging dir orphaned by an earlier crash
        // A private 0700 temp dir with unguessable per-clip names, so a local user can't pre-plant a
        // symlink at a predictable /tmp path and have ffmpeg overwrite a victim file.
        incidentClipTmpDir = mkdtempSync(join(tmpdir(), 'sk-clip-'));
        const clipTmp = incidentClipTmpDir;
        const clipProducer = createFfmpegClipProducer({
          spawn: (args) => spawn('ffmpeg', args, { stdio: 'ignore' }),
          writeFile: (path, data) => writeFileSync(path, data, { mode: 0o600 }),
          readFile: (path) => fsReadFile(path),
          removeFile: (path) => rmSync(path, { force: true }),
          tmpDir: () => clipTmp,
          idGen: () => randomUUID(),
        });
        incidents = new IncidentController({
          store: incidentStore,
          captureSnapshot: (id) => snapshotService.captureBytes(id),
          produceClip: clipProducer,
          listSegments: () => (recDir ? scanRecordings(recDir) : []),
          getSelfState: () => skBridge.getSelfState(),
          relevantCameras: () =>
            Object.entries(cameras?.list() ?? {})
              .filter(([, camera]) => camera.enabled)
              .map(([id]) => id),
          raiseNotification: (message, data) =>
            void skBridge.raiseNotification('incident', { state: 'alert', message, data }),
          clearNotification: () => void skBridge.clearNotification('incident'),
          segmentSeconds: RECORDING_SEGMENT_SECONDS,
          defaultPreMs: INCIDENT_DEFAULT_PRE_MS,
          defaultPostMs: INCIDENT_DEFAULT_POST_MS,
          sampleIntervalMs: INCIDENT_SAMPLE_INTERVAL_MS,
          finalizeGraceMs: INCIDENT_FINALIZE_GRACE_MS,
        });

        // Manual trigger (the reliable path): a Signal K PUT action — the server enforces auth.
        skBridge.registerAction('cameras.incident.mark', (value) => {
          const parsed = validateTriggerRequest(
            typeof value === 'object' && value !== null ? value : {},
          );
          if (!parsed.valid || !parsed.value) {
            return {
              state: 'FAILED',
              statusCode: 400,
              message: parsed.errors.join('; ') || 'invalid trigger',
            };
          }
          incidents?.mark({ ...parsed.value, source: 'manual' });
          return { state: 'COMPLETED', statusCode: 200 };
        });

        // Opt-in auto-trigger off a Signal K notification subtree (default disabled). Best-effort:
        // fires only on alert/alarm/emergency, debounced per path; a no-op without streambundle.
        const autoTriggerPath = options?.autoTriggerPath?.trim();
        if (autoTriggerPath) {
          incidentUnsub = skBridge.onDelta(autoTriggerPath, (delta) => {
            const decision = shouldTrigger(
              delta,
              { states: DEFAULT_TRIGGER_STATES, cooldownMs: INCIDENT_TRIGGER_COOLDOWN_MS },
              triggerState,
              Date.now(),
            );
            if (decision.fire && decision.key) {
              triggerState.lastFiredAtByKey[decision.key] = Date.now();
              incidents?.mark({
                source: 'signalk',
                path: decision.key,
                state: decision.state,
                note: decision.reason,
              });
            }
          });
        }

        // Serve bundles read-mostly; clients can only patch label/notes/pinned, never create one.
        app.registerResourceProvider({
          type: 'incidents',
          methods: createIncidentResourceMethods(incidentStore),
        });

        incidentSweep = setInterval(() => {
          try {
            if (!incidentStore) {
              return;
            }
            for (const id of bundlesToPrune(
              incidentStore.summaries(),
              INCIDENT_QUOTA,
              Date.now(),
            )) {
              incidentStore.delete(id);
            }
          } catch {
            // a transient FS error during prune must not crash the plugin; next sweep retries
          }
        }, INCIDENT_SWEEP_MS);
        incidentSweep.unref?.();

        // Anchor-watch automation: on the rising edge of an anchor-drag / geofence alarm raised by
        // another source, capture a (silent) evidence bundle on the anchor/security cameras and raise
        // one consolidated 'anchorWatch' notification; clear it when the alarm clears. Never computes
        // drag itself.
        watch = new WatchAutomation({
          getCameras: () =>
            Object.entries(cameras?.list() ?? {}).map(([id, camera]) => ({
              id,
              role: camera.role,
              enabled: camera.enabled,
            })),
          captureEvidence: (cameraIds, context) =>
            incidents?.mark({
              cameras: cameraIds,
              source: 'signalk',
              path: context.path,
              state: context.state,
              note: 'anchor/geofence watch',
              silent: true, // the watch owns the single consolidated notification below
            })?.id ?? null,
          raiseNotification: (message, data) =>
            void skBridge.raiseNotification('anchorWatch', {
              state: asAlarmState(data.state),
              message,
              data,
            }),
          clearNotification: () => void skBridge.clearNotification('anchorWatch'),
          log,
        });
        const anchorWatchPath =
          options?.anchorWatchPath?.trim() ?? 'notifications.navigation.anchor';
        if (anchorWatchPath) {
          watchUnsub = skBridge.onDelta(anchorWatchPath, (delta) => watch?.onNotification(delta));
        }

        // Safety-camera watchdog: poll go2rtc health for cameras the operator flagged safetyCritical
        // and raise/clear a debounced Signal K notification when one goes dark after being live.
        watchdog = new StreamWatchdog({
          getMonitoredCameras: () =>
            Object.entries(cameras?.list() ?? {})
              .filter(([, camera]) => camera.enabled && camera.safetyCritical === true)
              .map(([id]) => id),
          fetchHealth: (id) =>
            fetchStreamHealth({ apiPort: gateway?.apiPort ?? 1984, cameraId: id }),
          raiseNotification: (id) =>
            void skBridge.raiseNotification(`camera.${id}.offline`, {
              state: 'alarm',
              message: `Safety camera "${id}" has gone dark.`,
              data: { camera: id },
            }),
          clearNotification: (id) => void skBridge.clearNotification(`camera.${id}.offline`),
          log,
        });
        watchdogTimer = setInterval(() => {
          void watchdog?.poll().catch(() => undefined);
        }, WATCHDOG_POLL_MS);
        watchdogTimer.unref?.();

        // Frigate interop: consume a USER-RUN Frigate's MQTT events (we run no inference) and surface
        // person/car/boat detections as Signal K notifications + cached, same-origin-served clips.
        // Never bundled; close-range COCO-class only. Active only when an MQTT URL is configured.
        const frigateMqttUrl = options?.frigateMqttUrl?.trim() ?? '';
        if (options?.mobVisualRefine === true && !frigateMqttUrl) {
          // The experimental refine has no detection source without Frigate — say so rather than
          // sit silently inert while the operator believes visual refine is armed.
          log(
            'mobVisualRefine is enabled but no Frigate MQTT URL is configured; the experimental visual refine will not run.',
          );
        }
        if (frigateMqttUrl) {
          frigateClips = new AssetStore({
            index: new FileAssetIndexPersistence(dataDir, 'frigate-clips.json'),
            blobs: new FileBlobStore(dataDir, 'frigate-clips'),
            limits: FRIGATE_CLIP_LIMITS,
          });
          const frigateApiUrl = options?.frigateApiUrl?.trim() ?? '';
          frigateClient = new FrigateClient({
            config: {
              labels: csvList(options?.frigateLabels, ['person', 'car']),
              minScore: Math.min(
                1,
                Math.max(
                  0,
                  typeof options?.frigateMinScore === 'number' ? options.frigateMinScore : 0.7,
                ),
              ),
              zones: csvList(options?.frigateZones, []),
            },
            raiseNotification: (key, message, data) =>
              void skBridge.raiseNotification(key, { state: 'alert', message, data }),
            clearNotification: (key) => void skBridge.clearNotification(key),
            fetchClip: (eventId) =>
              frigateApiUrl
                ? fetchFrigateClip(frigateApiUrl, eventId, {
                    assertHost: (host) => assertHostAllowed(host, ssrfOptions, lookup),
                    maxBytes: FRIGATE_CLIP_MAX_BYTES,
                    timeoutMs: FRIGATE_FETCH_TIMEOUT_MS,
                  })
                : Promise.reject(new Error('no Frigate API URL configured')),
            storeClip: (eventId, bytes) =>
              frigateClips
                ? cacheFrigateClip(frigateClips, bytes, `${frigateSlug(eventId)}.mp4`)
                : null,
            log,
          });
          // A1 (EXPERIMENTAL, NOT safety-rated): when the operator opts in, a confident Frigate person
          // detection adds a small, bounded relativeMove correction ON TOP of MOB's authoritative
          // geo-pointing. It fails safe — a periodic check reverts to position-based aim and notifies
          // when detections stall. It needs Frigate, so it lives in this block and is null otherwise.
          if (options?.mobVisualRefine === true) {
            visualRefine = new MobVisualRefine({
              raiseNotification: (message) =>
                void skBridge.raiseNotification('mob.visualRefine.lost', {
                  state: 'alert',
                  message,
                }),
              clearNotification: () => void skBridge.clearNotification('mob.visualRefine.lost'),
              log,
            });
            visualRefineTimer = setInterval(
              () => visualRefine?.checkTrackLoss(),
              VISUAL_REFINE_CHECK_MS,
            );
            visualRefineTimer.unref?.();
          }
          try {
            frigateMqtt = connectFrigateMqtt({ url: frigateMqttUrl });
            frigateMqtt.on('error', (err) =>
              app.error?.(`[sk-video] frigate mqtt: ${redactUrl(err.message)}`),
            );
            frigateMqtt.on('message', (topic, payload) => {
              if (topic !== FRIGATE_EVENT_TOPIC) {
                return;
              }
              frigateClient?.handleMessage(payload);
              feedVisualRefine(payload);
            });
            frigateMqtt.subscribe(FRIGATE_EVENT_TOPIC);
          } catch (err) {
            app.error?.(
              `[sk-video] frigate mqtt connect failed: ${redactUrl(err instanceof Error ? err.message : String(err))}`,
            );
          }
          // Expire quiet alerts even during a fully silent period (the message-driven sweep can't).
          frigatePruneTimer = setInterval(() => frigateClient?.sweep(), FRIGATE_SWEEP_MS);
          frigatePruneTimer.unref?.();
        }

        const base = createCameraResourceMethods(cameras);
        app.registerResourceProvider({
          type: 'cameras',
          methods: {
            ...base,
            async setResource(id: string, value: Record<string, unknown>) {
              const result = validateCamera(value);
              if (result.valid && result.value) {
                await assertHostAllowed(result.value.source.host, ssrfOptions, lookup);
                // If the camera is repointed at a different endpoint, drop its stored credentials so a
                // saved password can't be exfiltrated by editing the host to an attacker's server.
                const prev = cameras?.get(id)?.source;
                if (prev && sourceEndpointChanged(prev, result.value.source)) {
                  credentials?.delete(id);
                }
              }
              await base.setResource(id, value);
              ptz?.invalidate(id);
              scheduleSync();
            },
            async deleteResource(id: string) {
              await base.deleteResource(id);
              // Drop the camera's stored credentials too, so a deleted camera never leaves an
              // orphaned secret behind (and a later camera reusing the id can't inherit it).
              credentials?.delete(id);
              ptz?.invalidate(id);
              scheduleSync();
            },
          },
        });

        const count = Object.keys(cameras.list()).length;
        app.setPluginStatus(
          `Ready — ${count} camera${count === 1 ? '' : 's'} · ${describeTier(hardware)}`,
        );
        scheduleSync(); // start go2rtc if cameras are already configured
      } catch (err) {
        const message = redactUrl(err instanceof Error ? err.message : String(err));
        app.error?.(`[sk-video] failed to start: ${message}`);
        app.setPluginError(`Failed to start: ${message}`);
      }
    },

    stop() {
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      if (recordingSweep) {
        clearInterval(recordingSweep);
        recordingSweep = null;
      }
      if (incidentSweep) {
        clearInterval(incidentSweep);
        incidentSweep = null;
      }
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      watchdog?.reset(); // clears any outstanding "camera dark" alarms while the bridge is still live
      watchdog = null;
      if (frigatePruneTimer) {
        clearInterval(frigatePruneTimer);
        frigatePruneTimer = null;
      }
      frigateMqtt?.end(true); // stop consuming events before the client/bridge are torn down
      frigateMqtt = null;
      if (visualRefineTimer) {
        clearInterval(visualRefineTimer);
        visualRefineTimer = null;
      }
      visualRefine?.deactivate(); // clears any outstanding "tracking lost" banner while bridge is live
      visualRefine = null;
      frigateClient?.reset(); // clears outstanding Frigate alerts while the bridge is still live
      frigateClient = null;
      frigateClips = null;
      // Tear down the notification subscription BEFORE the bridge is dropped — a leaked Bacon
      // subscription would survive a plugin restart and double-fire.
      // Tear down both notification subscriptions BEFORE the bridge is dropped — a leaked Bacon
      // subscription would survive a plugin restart and double-fire.
      incidentUnsub?.();
      incidentUnsub = null;
      watchUnsub?.();
      watchUnsub = null;
      watch?.reset();
      watch = null;
      incidents?.cancelAll(); // marks disposed + clears timers so no finalize publishes after stop()
      triggerState.lastFiredAtByKey = {};
      if (incidentClipTmpDir) {
        rmSync(incidentClipTmpDir, { recursive: true, force: true });
        incidentClipTmpDir = null;
      }
      ptz?.disposeAll();
      mob?.deactivate(); // stops MOB-started recorders before we tear the manager down
      recordings?.stopAll();
      const stopping = gateway?.stop();
      cameras = null;
      credentials = null;
      gateway = null;
      ptz = null;
      discovery = null;
      videos = null;
      hardware = null;
      bridge = null;
      snapshots = null;
      recordings = null;
      recordingsDir = null;
      mobRecording = [];
      mob = null;
      incidents = null;
      incidentStore = null;
      return stopping;
    },

    registerWithRouter(router: IRouter) {
      router.get('/status', (_req: Request, res: Response) => {
        res.json({
          ready: cameras !== null,
          cameras: cameras ? Object.keys(cameras.list()).length : 0,
          hardware,
        });
      });

      // Credential presence — booleans only, never the secret — so the UI can show a saved state.
      // Rate-limited so it can't be used to enumerate which cameras have credentials.
      router.get('/cameras/:id/credentials', (req: Request, res: Response) => {
        if (tooManyRequests(req, res)) {
          return;
        }
        if (!credentials) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        res.json(credentials.presence(String(req.params.id)));
      });

      // Write-only camera credentials.
      router.post('/cameras/:id/credentials', (req: Request, res: Response) => {
        if (tooManyRequests(req, res)) {
          return;
        }
        if (!credentials) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        try {
          const id = String(req.params.id);
          credentials.set(id, (req.body as unknown) ?? {});
          ptz?.invalidate(id);
          scheduleSync();
          res.status(204).end();
        } catch (err) {
          res.status(400).json({
            error: err instanceof Error ? err.message : 'invalid credentials',
          });
        }
      });
      router.delete('/cameras/:id/credentials', (req: Request, res: Response) => {
        if (tooManyRequests(req, res)) {
          return;
        }
        if (!credentials) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        const id = String(req.params.id);
        const existed = credentials.delete(id);
        if (existed) {
          ptz?.invalidate(id);
          scheduleSync();
        }
        res.status(existed ? 204 : 404).end();
      });

      // Man-overboard activate/deactivate (also exposed as a Signal K PUT action).
      router.post('/mob', (req: Request, res: Response) => {
        if (!mob) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        if ((req.body as { active?: unknown })?.active === false) {
          mob.deactivate();
          visualRefine?.deactivate();
          res.json({ active: false });
          return;
        }
        const status = mob.activate();
        visualRefine?.activate();
        res.json(status);
      });

      // Same-origin transport proxy to go2rtc (WHEP / frame.jpeg / HLS).
      registerProxyRoutes(router, {
        apiPort: () => gateway?.apiPort ?? 1984,
        hasCamera: (id: string) => cameras?.get(id) !== null && cameras?.get(id) !== undefined,
        hasSubstream: (id: string) => cameras?.get(id)?.media?.substreamPath !== undefined,
        hasBackchannel: (id: string) => cameras?.get(id)?.capabilities?.audioBackchannel === true,
      });

      // Read-only role/placement layout hints for the widget to auto-arrange feeds by area.
      registerLayoutRoute(router, () => (cameras ? cameras.list() : null));

      // ONVIF PTZ control.
      registerPtzRoutes(router, () => ptz);

      // ONVIF imaging presets (Day/Night/Fog/Glare/Auto), capability-gated + relative to current.
      registerImagingRoutes(router, {
        ready: () => cameras !== null,
        hasCamera: (id: string) => cameras?.get(id) !== null && cameras?.get(id) !== undefined,
        getImaging: async (id) => {
          const controller = await ptz?.controllerFor(id);
          if (!controller) {
            throw new Error('PTZ controller unavailable');
          }
          return controller.getImaging();
        },
        setImaging: async (id, update) => {
          const controller = await ptz?.controllerFor(id);
          if (!controller) {
            throw new Error('PTZ controller unavailable');
          }
          await controller.setImaging(update);
        },
      });

      // AIS slew-to-cue: aim a calibrated PTZ camera once at the nearest-CPA AIS target. A single
      // deterministic geo-point (shares the MOB engine), not tracking; re-POST to re-cue.
      registerSlewRoutes(router, {
        ready: () => cameras !== null,
        getCamera: (id) => cameras?.get(id) ?? null,
        getOwnShip: () => (bridge ? slewOwnShipFromSelfState(bridge.getSelfState()) : null),
        getTargets: () => parseAisTargets(safeGetPath('vessels'), app.selfId),
        aimCamera: async (id, pan, tilt) => {
          const controller = await ptz?.controllerFor(id);
          if (!controller) {
            throw new Error('PTZ controller unavailable');
          }
          await controller.moveAbsolute({ pan, tilt });
        },
      });

      // Camera auto-discovery (WS-Discovery + mDNS), rate-limited.
      registerDiscoveryRoutes(router, () => discovery);

      // Action-cam / 360 onboarding hints (GoPro / Insta360) — curated, opportunistic, honest.
      registerOnboardingHintsRoute(router);

      // Zero-typing onboarding: introspect a discovered ONVIF camera to pre-fill the add form.
      registerIntrospectRoute(router, {
        ready: () => cameras !== null,
        assertHostAllowed: (host) => assertHostAllowed(host, ssrfOptions, lookup),
        introspect: (input) =>
          introspectOnvifCamera(input, {
            assertHostAllowed: (host) => assertHostAllowed(host, ssrfOptions, lookup),
          }),
        rateLimit,
      });

      // Uploaded video library: store + Range-served playback.
      registerUploadRoutes(router, () => videos);

      // Cached Frigate clips: read-only list + Range-served playback (same-origin).
      registerFrigateClipRoutes(router, { getStore: () => frigateClips });

      // Capture a telemetry-stamped snapshot (position/heading/… from the Signal K bus burned into
      // the stored frame's sidecar). Same-origin and keyed by a known camera id.
      router.post('/cameras/:id/snapshot', async (req: Request, res: Response) => {
        if (!snapshots || !cameras) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        const id = String(req.params.id);
        if (!cameras.get(id)) {
          res.status(404).json({ error: 'unknown camera' });
          return;
        }
        try {
          res.status(201).json(await snapshots.capture(id));
        } catch (err) {
          res.status(502).json({
            error: redactUrl(err instanceof Error ? err.message : 'snapshot failed'),
          });
        }
      });

      // DVR recording: per-camera start/stop, segment listing, and Range-served segment playback.
      registerRecordingRoutes(router, {
        getManager: () => recordings,
        hasCamera: (id: string) => cameras?.get(id) !== null && cameras?.get(id) !== undefined,
        listSegments: () => (recordingsDir ? scanRecordings(recordingsDir) : []),
      });

      // Incident bundles: trigger, list, manifest, Range-served assets, patch + delete.
      registerIncidentRoutes(router, {
        getController: () => incidents,
        getStore: () => incidentStore,
      });

      // Connection test for an unsaved camera (ffprobe / TCP reachability, SSRF-guarded).
      registerTestRoutes(router, {
        ready: () => cameras !== null,
        assertHostAllowed: (host) => assertHostAllowed(host, ssrfOptions, lookup),
        runFfprobe,
        tcpProbe,
        rateLimit,
      });
    },
  };

  return plugin;
};
