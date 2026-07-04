import type { Plugin, ServerAPI } from '@signalk/server-api';
import type { IRouter, Request, Response } from 'express';
import { promises as dns } from 'node:dns';
import { CameraStore } from './cameras/camera-store';
import { CredentialStore } from './cameras/credential-store';
import { FileCameraPersistence, FileCredentialPersistence } from './cameras/file-persistence';
import { createCameraResourceMethods } from './cameras/resource-provider';
import { registerLayoutRoute } from './cameras/layout-routes';
import { registerAppRoutes } from './web/app-routes';
import { registerSessionRoute } from './web/session-routes';
import { EventLog, FileEventLogPersistence } from './web/event-log';
import { registerEventLogRoutes } from './web/event-log-routes';
import webpush from 'web-push';
import { PushStore, FilePushStorePersistence } from './web/push-store';
import { registerPushRoutes } from './web/push-routes';
import { fanOutPush } from './web/push-sender';
import { notificationForEvent } from './web/push-events';
import { loadOrCreateVapidKeys, fileVapidIo } from './web/vapid';
import { registerConfigRoutes } from './web/config-routes';
import { registerAckRoutes } from './web/ack-routes';
import type { IOperationalConfig } from './web/operational-config';
import { validateCamera, sourceEndpointChanged } from './cameras/camera-validation';
import { assertHostAllowed, type ISsrfOptions } from './security/ssrf-guard';
import { redactUrl } from './security/redact';
import { RateLimiter } from './security/rate-limit';
import { withTimeout } from './security/with-timeout';
import { Go2rtcBinaryManager } from './gateway/go2rtc-binary-manager';
import { Go2rtcProcess } from './gateway/go2rtc-process';
import { Go2rtcGateway } from './gateway/go2rtc-gateway';
import { registerProxyRoutes } from './gateway/go2rtc-proxy-routes';
import { candidateHost } from './gateway/sdp-scrub';
import { LastGoodTracker, loadLastGoodSnapshot, saveLastGoodSnapshot } from './gateway/last-good';
import { StreamWatchdog } from './gateway/stream-watchdog';
import {
  feedOutagePath,
  buildCameraHealthMeta,
  zonesForThresholds,
  buildCameraHealthTeardown,
} from './signalk/camera-meta';
import { fetchStreamHealth, fetchAllStreamsHealth } from './gateway/stream-health';
import { registerCamerasProjectionRoute } from './cameras/cameras-projection-routes';
import { PtzManager } from './onvif/ptz-manager';
import { registerPtzRoutes } from './onvif/ptz-routes';
import { registerImagingRoutes } from './onvif/imaging-routes';
import { registerAuxRoutes } from './onvif/aux-routes';
import { registerCalibrationRoute } from './onvif/calibration-routes';
import { ImagingPresetApplier } from './onvif/imaging-apply';
import { isAfterDusk } from './safety/dusk';
import {
  isAuthorizedSensitiveRequest,
  isReadOnlyPrincipal,
  type ISecurityStrategy,
  type IAuthenticatableRequest,
} from './security/request-auth';
import { DiscoveryService } from './discovery/discovery-service';
import { createWsDiscoveryProbe } from './discovery/ws-discovery-probe';
import { createMdnsProbe } from './discovery/mdns-probe';
import { createSsdpProbe } from './discovery/ssdp-probe';
import { registerDiscoveryRoutes } from './discovery/discovery-routes';
import { registerIntrospectRoute } from './discovery/introspect-routes';
import { registerOnboardingHintsRoute } from './discovery/device-hints';
import { introspectOnvifCamera } from './onvif/onvif-introspect';
import { registerRescanRoutes } from './onvif/rescan-routes';
import { refreshChangedCameras } from './cameras/capability-refresh';
import { createOnvifConnect } from './onvif/onvif-connect';
import { OnvifPtzController } from './onvif/onvif-controller';
import { MobController } from './safety/mob-controller';
import { toMobCamera, ownShipFromSelfState, findMobBeacon } from './safety/mob-wiring';
import { MobVisualRefine, frigatePersonDetection } from './safety/mob-visual-refine';
import { registerMobStatusRoute } from './safety/mob-status-routes';
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
import { wireFrigateMqtt } from './analytics/frigate-mqtt-wiring';
import { validateFrigateConfig } from './analytics/frigate-config';
import { registerFrigateClipRoutes } from './analytics/frigate-clip-routes';
import { fetchFrigateClip } from './analytics/frigate-clip-fetch';
import { cacheFrigateClip } from './analytics/frigate-clip-cache';
import { registerUploadRoutes } from './uploads/upload-routes';
import { registerTestRoutes } from './diagnostics/test-routes';
import { runFfprobe, tcpProbe } from './diagnostics/probe-runner';
import {
  detectHardware,
  describeTier,
  type THardwareTier,
  type IHardwareInfo,
} from './hardware/tier-detect';
import { SignalKBridge, type ISignalKApp, type AlarmState } from './signalk/sk-bridge';
import { SnapshotService } from './recording/snapshot-service';
import { FileSnapshotStore } from './recording/file-snapshot-store';
import { registerSnapshotReadRoutes } from './recording/snapshot-read-routes';
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// VAPID contact subject sent to the push service (informational; no real address is required and we
// keep no PII here). Must be a mailto: or https: URI per RFC 8292.
const PUSH_SUBJECT = 'mailto:sk-video@localhost';
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
  let snapshotStore: FileSnapshotStore | null = null;
  let eventLog: EventLog | null = null;
  let pushStore: PushStore | null = null;
  let vapidPublicKey: string | null = null;
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
  // Went-dark vs never-seen: every health read stamps this, the health DTO carries it. Rebuilt in
  // start() from the persisted snapshot so an outage spanning a restart stays visible.
  let lastGood = new LastGoodTracker();
  let saveLastGood: (() => void) | null = null;
  let frigateClient: FrigateClient | null = null;
  let frigateMqtt: IMqttConnection | null = null;
  // Live broker-link state so the console can say "Frigate not connected" instead of implying
  // an empty feed means nothing was detected.
  let frigateConnected = false;
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
  // Operational config now lives in the web app (the SK admin schema is empty). It arrives as the
  // plugin's persisted options; `currentConfig` is the live copy GET /config reads, and
  // `pluginRestart` is the server-provided restart(newConfig) we call to persist + re-wire on a save.
  let currentConfig: IOperationalConfig = {};
  let pluginRestart: ((cfg: object) => void) | null = null;
  let started = false;

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

  // The Signal K security strategy isn't in the public ServerAPI types; read it structurally.
  const securityStrategy = (app as unknown as { securityStrategy?: ISecurityStrategy })
    .securityStrategy;
  // Gate a sensitive route: on a secured server, refuse an unauthenticated caller with 401 so the
  // credential routes can't be used to enumerate which cameras have a stored login. Open servers and
  // authenticated callers pass through. Returns true when the request was rejected.
  const unauthorized = (req: Request, res: Response): boolean => {
    if (!isAuthorizedSensitiveRequest(securityStrategy, req as IAuthenticatableRequest)) {
      res.status(401).json({ error: 'authentication required' });
      return true;
    }
    // Authenticated but KNOWN read-only: a readonly Signal K principal must not trigger writes
    // (arm MOB, record, PTZ, delete). An unknown permission shape passes — only certainty denies.
    if (isReadOnlyPrincipal(req as IAuthenticatableRequest)) {
      res.status(403).json({ error: 'write permission required' });
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

  /** The normal "all good" plugin status line — reused on startup and when the gateway recovers. */
  function readyStatus(): string {
    const count = cameras ? Object.keys(cameras.list()).length : 0;
    const suffix = hardware ? ` · ${describeTier(hardware)}` : '';
    return `Ready — ${count} camera${count === 1 ? '' : 's'}${suffix}`;
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

    // The Signal K admin form is intentionally EMPTY — every operational knob (Frigate, anchor watch,
    // incident auto-trigger, visual-MOB refine, hardware-tier) is owned by the SK Video web app
    // (Settings → Operational) and persisted via the restart() contract. This keeps the SK admin clean.
    schema: () => ({
      type: 'object',
      properties: {},
    }),

    start(options?: IOperationalConfig, restart?: (cfg: object) => void) {
      currentConfig = options ?? {};
      pluginRestart = restart ?? pluginRestart;
      try {
        const dataDir = app.getDataDirPath();
        // Hydrate last-good from disk: a camera that died while we were down must still alarm once
        // the outage exceeds the thresholds, instead of resetting to "never seen".
        const lastGoodSeed = loadLastGoodSnapshot(dataDir);
        lastGood = new LastGoodTracker(undefined, { seed: lastGoodSeed });
        let lastGoodPersisted = '';
        saveLastGood = () => {
          const snapshot = lastGood.snapshot();
          const encoded = JSON.stringify(snapshot);
          if (encoded !== lastGoodPersisted) {
            lastGoodPersisted = encoded;
            saveLastGoodSnapshot(dataDir, snapshot);
          }
        };
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
          process: new Go2rtcProcess({
            log,
            // go2rtc keeps retrying on its own; surface a down/recovered status so a silent gateway
            // failure (e.g. a boot-time port conflict) is visible instead of a stale "Ready".
            onDegraded: (attempts) =>
              app.setPluginError(
                `Video gateway is down — go2rtc failed to start (${attempts} attempts) and is retrying. Check for a port conflict on 1984/8554/8555.`,
              ),
            onHealthy: () => app.setPluginStatus(readyStatus()),
          }),
          // Optional explicit WebRTC ICE host candidates (`ip:port,ip:port`) for hosts where go2rtc
          // can't auto-detect a browser-reachable address (NAT / multi-homed / containerized). Off
          // unless set; the e2e screenshot harness uses it to make WebRTC reachable from the host.
          webrtcCandidates: (process.env.SKVIDEO_GO2RTC_CANDIDATES ?? '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
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

        // The durable activity feed: every notification raised through the bridge (MOB, incident,
        // anchor drag, camera-offline) is tapped into an append-only log so the console can
        // reconstruct what happened after the transient notifications have cleared.
        eventLog = new EventLog({ persistence: new FileEventLogPersistence(dataDir) });

        // Web Push: a stable VAPID keypair (persisted) lets opted-in devices receive safety alerts
        // even when the app is closed. The Pi only ever makes OUTBOUND requests to the browser's push
        // service — it never needs to be reachable from the internet. Delivery still needs the boat to
        // have connectivity, so this is best-effort, surfaced honestly in the UI.
        pushStore = new PushStore({ persistence: new FilePushStorePersistence(dataDir) });
        try {
          const vapid = loadOrCreateVapidKeys(fileVapidIo(dataDir), () =>
            webpush.generateVAPIDKeys(),
          );
          webpush.setVapidDetails(PUSH_SUBJECT, vapid.publicKey, vapid.privateKey);
          vapidPublicKey = vapid.publicKey;
        } catch (err) {
          log(
            `web-push setup failed; alerts disabled: ${err instanceof Error ? err.message : err}`,
          );
          vapidPublicKey = null;
        }

        // Fan a safety event out to every subscribed device, pruning dead subscriptions. Best-effort:
        // never let a push failure affect the safety path that raised the notification.
        const sendSafetyPush = (type: string, state?: string, message?: string): void => {
          const note = notificationForEvent(type, state, message);
          if (!note || !pushStore || !vapidPublicKey) return;
          void fanOutPush(pushStore.list(), note, {
            send: (sub, payload) =>
              webpush.sendNotification(sub, payload) as Promise<{ statusCode: number }>,
            onGone: (endpoint) => pushStore?.remove(endpoint),
            log,
          }).catch(() => undefined);
        };

        // The Signal K bridge speaks plain Signal K JSON; the server's branded delta/notification
        // types are a structural superset, so we adapt at this single boundary.
        bridge = new SignalKBridge(app as unknown as ISignalKApp, PLUGIN_ID, {
          onNotify: (key, opts) => {
            eventLog?.append({ type: key, state: opts.state, message: opts.message });
            sendSafetyPush(key, opts.state, opts.message);
          },
        });
        snapshotStore = new FileSnapshotStore(dataDir, 'snapshots', {
          maxCount: SNAPSHOT_MAX_COUNT,
          maxAgeMs: SNAPSHOT_MAX_AGE_MS,
        });
        snapshots = new SnapshotService({
          capture: async (id: string) => {
            const upstream = await fetch(go2rtcApiUrl(gateway?.apiPort ?? 1984, 'frame', id));
            if (!upstream.ok) {
              throw new Error(`frame fetch failed (${upstream.status})`);
            }
            return new Uint8Array(await upstream.arrayBuffer());
          },
          selfSource: bridge,
          store: snapshotStore,
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
          log,
        });
        recordingSweep = setInterval(() => {
          try {
            recordings?.sweep(Date.now());
          } catch {
            // a transient FS error during prune must not crash the plugin; next sweep retries
          }
        }, RECORDING_SWEEP_MS);
        recordingSweep.unref?.();

        // Auto low-light: after dusk, MOB and anchor-watch switch imaging-capable cameras to the
        // night preset so the evidence/aim sees as much as the hardware allows. Shared by both flows.
        const imagingApplier = new ImagingPresetApplier({
          getImaging: async (id) => (await ptz!.controllerFor(id)).getImaging(),
          setImaging: async (id, update) => (await ptz!.controllerFor(id)).setImaging(update),
        });
        // Dark enough to bother? Computed from the boat's own position + the current time; false when
        // there's no fix (we never guess), so daylight or an unknown position leaves imaging untouched.
        const isDarkNow = (): boolean => {
          const pos = (bridge ? ownShipFromSelfState(bridge.getSelfState()) : null)?.position;
          return pos ? isAfterDusk(new Date(), pos.latitude, pos.longitude) : false;
        };
        // A camera can only act on a low-light preset if it speaks ONVIF imaging; skip the rest quietly
        // rather than poke a plain RTSP feed that has no lever (which would just log a failure per event).
        const applyLowLight = (cameraIds: string[]): void => {
          for (const id of cameraIds) {
            const cam = cameras?.get(id);
            const mayHaveImaging =
              cam !== null &&
              cam !== undefined &&
              (cam.source.scheme === 'onvif' || (cam.capabilities?.imaging?.length ?? 0) > 0);
            if (!mayHaveImaging) {
              continue;
            }
            void imagingApplier
              .apply(id, 'night')
              .catch((err: unknown) =>
                log(
                  `low-light preset failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
          }
        };

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
          isDark: isDarkNow,
          applyLowLight,
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
              try {
                incidentStore.delete(id);
              } catch {
                // one un-deletable bundle must not halt pruning of the rest (disk would fill)
              }
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
          isDark: isDarkNow,
          applyLowLight,
          log,
        });
        const anchorWatchPath =
          options?.anchorWatchPath?.trim() ?? 'notifications.navigation.anchor';
        if (anchorWatchPath) {
          watchUnsub = skBridge.onDelta(anchorWatchPath, (delta) => watch?.onNotification(delta));
        }

        // Camera health watchdog: poll go2rtc health for every enabled camera, publish each one's
        // telemetry into the Signal K model (cameras.<id>.feedOutage/producers/consumers), and
        // raise/clear a debounced alarm ON THE CAMERA'S OWN PATH for cameras the operator flagged
        // safetyCritical. The alarm lives at notifications.cameras.<id>.feedOutage — mirroring the
        // gauge path — so a later zones handover raises the very same notification.
        const cameraDisplayName = (id: string): string => cameras?.get(id)?.name ?? id;
        // Per-camera server-zone opt-in: an entry hands the camera's feed-outage alarm to the
        // server's zones watcher (we publish thresholds as meta.zones and suppress our own raise).
        const healthZones = options?.cameraHealthZones ?? {};
        // Declare what the health paths mean (displayName/units/timeout, plus zones when the user
        // opted in) so clients can label and stale-flag them without knowing sk-video. Re-emitted
        // when a camera definition changes.
        const emitCameraHealthMeta = (id: string): void => {
          const camera = cameras?.get(id);
          if (!camera?.enabled) return;
          const thresholds = healthZones[id];
          skBridge.emitMeta(
            buildCameraHealthMeta({
              id,
              name: camera.name,
              pollSeconds: WATCHDOG_POLL_MS / 1000,
              zones: thresholds ? zonesForThresholds(camera.name, thresholds) : undefined,
            }),
          );
        };
        for (const id of Object.keys(cameras?.list() ?? {})) {
          emitCameraHealthMeta(id);
        }
        watchdog = new StreamWatchdog({
          getMonitoredCameras: () =>
            Object.entries(cameras?.list() ?? {})
              .filter(([, camera]) => camera.enabled)
              .map(([id]) => id),
          // Single alarm authority: safety-critical cameras alarm via our watchdog UNLESS the user
          // handed this camera to server zones — then the server raises on the same path.
          isAlarmEligible: (id) =>
            cameras?.get(id)?.safetyCritical === true && healthZones[id] === undefined,
          fetchHealth: async (id) => {
            const health = await fetchStreamHealth({
              apiPort: gateway?.apiPort ?? 1984,
              cameraId: id,
            });
            lastGood.note(id, health.online); // watchdog polls double as last-good observations
            return health;
          },
          raiseNotification: (id) =>
            void skBridge.raiseNotification(feedOutagePath(id), {
              state: 'alarm',
              message: `Safety camera "${cameraDisplayName(id)}" has gone dark.`,
              path: feedOutagePath(id),
              data: { camera: id },
            }),
          clearNotification: (id) => void skBridge.clearNotification(feedOutagePath(id)),
          onSample: (id, sample) => {
            const values = [
              { path: `cameras.${id}.producers`, value: sample.producers },
              { path: `cameras.${id}.consumers`, value: sample.consumers },
            ];
            if (sample.feedOutageSeconds !== null) {
              values.unshift({ path: feedOutagePath(id), value: sample.feedOutageSeconds });
            }
            skBridge.emit(values);
          },
          seedAnchors: lastGoodSeed,
          log,
        });
        watchdogTimer = setInterval(() => {
          void watchdog
            ?.poll()
            .then(() => saveLastGood?.())
            .catch(() => undefined);
        }, WATCHDOG_POLL_MS);
        watchdogTimer.unref?.();

        // Frigate interop: consume a USER-RUN Frigate's MQTT events (we run no inference) and surface
        // person/car/boat detections as Signal K notifications + cached, same-origin-served clips.
        // Never bundled; close-range COCO-class only. Active only when an MQTT URL is configured.
        // Frigate connect settings are structured now (host/port/user + write-only password). Assemble
        // a credential-free broker URL for validation/logging; the username/password ride separately
        // into the MQTT client below so secrets never appear in a URL or a log line.
        const fr = options?.frigate;
        const frigateMqttUrl = fr?.mqttHost
          ? `${fr.mqttTls ? 'mqtts' : 'mqtt'}://${fr.mqttHost}:${fr.mqttPort ?? 1883}`
          : '';
        // Validate the guided connect settings before touching the network: a bad broker URL disables
        // Frigate (with a credential-free reason), a bad API URL just disables clip caching.
        const frigateCfg = validateFrigateConfig({
          mqttUrl: frigateMqttUrl,
          apiUrl: fr?.apiUrl,
        });
        const frigateUrlEntered = !!fr?.mqttHost;
        if (options?.mobVisualRefine === true && !frigateCfg.ok) {
          // The experimental refine has no detection source without Frigate — say so rather than
          // sit silently inert while the operator believes visual refine is armed.
          log(
            'mobVisualRefine is enabled but no valid Frigate MQTT URL is configured; the experimental visual refine will not run.',
          );
        }
        if (!frigateCfg.ok) {
          // Only nag if the operator actually typed something (blank = intentionally disabled).
          if (frigateUrlEntered) {
            log(`Frigate disabled: ${frigateCfg.error}`);
          }
        } else {
          for (const warning of frigateCfg.warnings) {
            log(`Frigate: ${warning}`);
          }
          frigateClips = new AssetStore({
            index: new FileAssetIndexPersistence(dataDir, 'frigate-clips.json'),
            blobs: new FileBlobStore(dataDir, 'frigate-clips'),
            limits: FRIGATE_CLIP_LIMITS,
          });
          const frigateApiUrl = frigateCfg.apiUrl ?? '';
          frigateClient = new FrigateClient({
            config: {
              labels: csvList(fr?.labels, ['person', 'car']),
              minScore: Math.min(
                1,
                Math.max(0, typeof fr?.minScore === 'number' ? fr.minScore : 0.7),
              ),
              zones: csvList(fr?.zones, []),
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
            frigateMqtt = connectFrigateMqtt({
              url: frigateCfg.mqttUrl,
              username: fr?.mqttUsername || undefined,
              password: fr?.mqttPassword || undefined,
            });
            frigateMqtt.on('connect', () => {
              frigateConnected = true;
            });
            frigateMqtt.on('close', () => {
              frigateConnected = false;
            });
            // Subscribes on every (re)connect, so a dropped link resumes event flow cleanly.
            wireFrigateMqtt(frigateMqtt, {
              topic: FRIGATE_EVENT_TOPIC,
              onMessage: (payload) => {
                frigateClient?.handleMessage(payload);
                feedVisualRefine(payload);
              },
              onError: (err) => app.error?.(`[sk-video] frigate mqtt: ${redactUrl(err.message)}`),
              log,
            });
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
        // Validate + host-check + persist a camera resource. Shared by the resource-provider write path
        // and the firmware-change auto re-scan so both go through the same guards.
        const persistCamera = async (id: string, value: Record<string, unknown>): Promise<void> => {
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
          emitCameraHealthMeta(id); // a rename/enable must refresh the health-path labels
          scheduleSync();
        };
        app.registerResourceProvider({
          type: 'cameras',
          methods: {
            ...base,
            setResource: persistCamera,
            async deleteResource(id: string) {
              // A zones-enabled camera deleted mid-alarm would leave a server-raised notification
              // nobody can clear: drive the gauge back into the normal zone, then disarm the zones,
              // BEFORE the camera disappears.
              if (healthZones[id]) {
                const teardown = buildCameraHealthTeardown(id);
                skBridge.emit(teardown.finalValue);
                skBridge.emitMeta(teardown.clearZonesMeta);
              }
              await base.deleteResource(id);
              // Drop the camera's stored credentials too, so a deleted camera never leaves an
              // orphaned secret behind (and a later camera reusing the id can't inherit it).
              credentials?.delete(id);
              ptz?.invalidate(id);
              lastGood.forget(id); // a re-added id must not inherit a stale last-seen
              scheduleSync();
            },
          },
        });

        started = true;
        app.setPluginStatus(readyStatus());
        scheduleSync(); // start go2rtc if cameras are already configured

        // Auto re-scan capabilities for any camera whose firmware changed since we last stored it
        // (and backfill cameras that predate capability discovery). Best-effort + background, so a
        // slow/offline camera never delays start; only cameras whose firmware actually changed are
        // re-introspected and re-saved.
        void refreshChangedCameras({
          cameras: () => Object.entries(cameras?.list() ?? {}),
          probeFirmware: async (id, camera) => {
            const creds = credentials?.get(id);
            const connect = createOnvifConnect({
              hostname: camera.source.host,
              port: camera.source.scheme === 'onvif' ? camera.source.port : undefined,
              username: creds?.username,
              password: creds?.password,
              allowSelfSigned: camera.allowSelfSigned,
            });
            const info = await new OnvifPtzController(connect).probeDeviceInfo();
            return info?.firmwareVersion || undefined;
          },
          introspect: (id, camera) =>
            introspectOnvifCamera(
              {
                host: camera.source.host,
                port: camera.source.scheme === 'onvif' ? camera.source.port : undefined,
                username: credentials?.get(id)?.username,
                password: credentials?.get(id)?.password,
              },
              { assertHostAllowed: (host) => assertHostAllowed(host, ssrfOptions, lookup) },
            ),
          save: (id, camera) => persistCamera(id, camera as unknown as Record<string, unknown>),
          log: (message) => app.debug?.(message),
        }).catch(() => undefined);
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
      saveLastGood?.(); // keep the on-disk last-good fresh so a restart-spanning outage still alarms
      saveLastGood = null;
      if (frigatePruneTimer) {
        clearInterval(frigatePruneTimer);
        frigatePruneTimer = null;
      }
      frigateMqtt?.end(true); // stop consuming events before the client/bridge are torn down
      frigateMqtt = null;
      frigateConnected = false;
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
      snapshotStore = null;
      eventLog = null;
      pushStore = null;
      vapidPublicKey = null;
      recordings = null;
      recordingsDir = null;
      mobRecording = [];
      mob = null;
      incidents = null;
      incidentStore = null;
      started = false;
      return stopping;
    },

    registerWithRouter(router: IRouter) {
      router.get('/status', (_req: Request, res: Response) => {
        res.json({
          ready: cameras !== null,
          cameras: cameras ? Object.keys(cameras.list()).length : 0,
          hardware,
          // Honest Frigate posture: an empty detection feed must be distinguishable from "not wired".
          frigate: { configured: frigateClient !== null, connected: frigateConnected },
        });
      });

      // Auth-only whoami the web app calls to learn whether security is on and whether it is signed in,
      // plus the plugin version (so a stale shell can prompt a reload). Booleans only — safe to leave open.
      let pluginVersion = 'unknown';
      try {
        const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
          version?: string;
        };
        pluginVersion = pkg.version ?? 'unknown';
      } catch {
        // Keep 'unknown' if the manifest can't be read; the version is advisory.
      }
      registerSessionRoute(router, { securityStrategy, pluginVersion });

      // Serve the SK Video web app (the built Vite bundle in public/) same-origin under /app, alongside
      // — never shadowing — the API routes. Assets are read once and cached for the process lifetime
      // (the bundle is static; the plugin restarts on redeploy). Path traversal is rejected upstream in
      // resolveAssetPath, so a vetted rel can never escape public/.
      const appPublicDir = join(__dirname, '..', 'public');
      const appAssetCache = new Map<string, Buffer | null>();
      registerAppRoutes(router, {
        readAsset: (rel: string) => {
          if (appAssetCache.has(rel)) {
            return appAssetCache.get(rel) ?? null;
          }
          let bytes: Buffer | null;
          try {
            bytes = readFileSync(join(appPublicDir, rel));
          } catch {
            bytes = null;
          }
          appAssetCache.set(rel, bytes);
          return bytes;
        },
      });

      // Credential presence — booleans only, never the secret — so the UI can show a saved state.
      // Authenticated (on a secured server) so it can't be used to enumerate which cameras have a
      // stored login, and rate-limited on top.
      router.get('/cameras/:id/credentials', (req: Request, res: Response) => {
        if (unauthorized(req, res) || tooManyRequests(req, res)) {
          return;
        }
        if (!credentials) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        res.json(credentials.presence(String(req.params.id)));
      });

      // Write-only camera credentials. Authenticated (storing a login is an operator action) + rate-limited.
      router.post('/cameras/:id/credentials', (req: Request, res: Response) => {
        if (unauthorized(req, res) || tooManyRequests(req, res)) {
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
        if (unauthorized(req, res) || tooManyRequests(req, res)) {
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

      // Man-overboard activate/deactivate (also exposed as a Signal K PUT action). The PUT action
      // path inherits the server's auth; this same-origin HTTP route must gate itself the same way.
      router.post('/mob', (req: Request, res: Response) => {
        if (unauthorized(req, res)) return;
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

      // Shared safety-event acknowledgement: writes back to Signal K notification state so every
      // client sees the alarm silenced (never a device-local ack).
      registerAckRoutes(router, {
        ack: (key) => bridge?.ackNotification(key) === true,
        gate: unauthorized,
      });

      // Read-only MOB status (module route, ratchet-covered) so a client can seed or repair the
      // armed state on connect / tab-foreground without triggering a re-aim.
      registerMobStatusRoute(router, {
        status: () => mob?.status() ?? null,
        visualRefine: () => ({
          enabled: visualRefine !== null,
          active: visualRefine?.isActive() === true,
        }),
      });

      // Same-origin transport proxy to go2rtc (WHEP / frame.jpeg / HLS).
      registerProxyRoutes(router, {
        apiPort: () => gateway?.apiPort ?? 1984,
        hasCamera: (id: string) => cameras?.get(id) !== null && cameras?.get(id) !== undefined,
        hasSubstream: (id: string) => !!cameras?.get(id)?.media?.substreamPath,
        hasBackchannel: (id: string) => cameras?.get(id)?.capabilities?.audioBackchannel === true,
        gate: unauthorized,
        // Operator-configured explicit candidates always survive ICE scrubbing (they asserted
        // reachability — the e2e harness's published loopback port relies on this).
        allowedCandidateHosts: () =>
          (process.env.SKVIDEO_GO2RTC_CANDIDATES ?? '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
            .map(candidateHost),
        noteHealth: (id, online) => lastGood.note(id, online),
        lastGood: (id) => lastGood.get(id),
      });

      // Aggregate wall projection: defs + health(+last-good) + transport + layout in one response,
      // so the heaviest screen on the worst link never fans out N health + N transport requests.
      registerCamerasProjectionRoute(router, {
        listCameras: () => (cameras ? cameras.list() : null),
        fetchAllHealth: async (ids) => {
          const healths = await fetchAllStreamsHealth({
            apiPort: gateway?.apiPort ?? 1984,
            cameraIds: ids,
          });
          for (const [id, health] of Object.entries(healths)) {
            lastGood.note(id, health.online); // bulk reads double as last-good observations
          }
          return healths;
        },
        lastGood: (id) => lastGood.get(id),
      });

      // Read-only role/placement layout hints for the widget to auto-arrange feeds by area.
      registerLayoutRoute(router, () => (cameras ? cameras.list() : null));

      // ONVIF PTZ control.
      registerPtzRoutes(router, () => ptz, unauthorized);

      // ONVIF auxiliary-command controls (spotlight / alarm), capability-gated on the tokens the camera
      // advertised at onboarding. Untested on real hardware — implemented to spec, validated by tests.
      registerAuxRoutes(
        router,
        {
          ready: () => cameras !== null,
          getPtz: () => ptz,
          getAuxCommands: (id: string) => {
            const camera = cameras?.get(id);
            return camera ? (camera.capabilities?.auxCommands ?? []) : null;
          },
        },
        unauthorized,
      );

      // ONVIF imaging presets (Day/Night/Fog/Glare/Auto), capability-gated + relative to current.
      registerImagingRoutes(
        router,
        {
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
        },
        unauthorized,
      );

      // AIS slew-to-cue: aim a calibrated PTZ camera once at the nearest-CPA AIS target. A single
      // deterministic geo-point (shares the MOB engine), not tracking; re-POST to re-cue.
      registerSlewRoutes(
        router,
        {
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
        },
        unauthorized,
      );

      // One-time FOV calibration capture: solve degrees → normalised-ONVIF from a two-point-per-axis
      // capture and persist it on the camera, so geo-pointing (MOB) and slew-to-cue can aim it.
      registerCalibrationRoute(
        router,
        {
          ready: () => cameras !== null,
          getCamera: (id) => cameras?.get(id) ?? null,
          setCalibration: async (id, calibration) => {
            const store = cameras;
            const camera = store?.get(id);
            if (!store || !camera) {
              throw new Error('unknown camera');
            }
            // Re-validate the whole record through the store (closed field-set + clamps) before saving.
            store.set(id, { ...camera, calibration });
          },
        },
        unauthorized,
      );

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
        gate: unauthorized,
      });

      // Re-scan an existing camera's capabilities using its stored credentials (so a camera picks up
      // newly-supported capabilities after a plugin update or a camera firmware change, without re-adding).
      registerRescanRoutes(
        router,
        {
          ready: () => cameras !== null,
          getCamera: (id) => cameras?.get(id) ?? null,
          getCredentials: (id) => credentials?.get(id) ?? null,
          introspect: (input) =>
            introspectOnvifCamera(input, {
              assertHostAllowed: (host) => assertHostAllowed(host, ssrfOptions, lookup),
            }),
        },
        unauthorized,
      );

      // Uploaded video library: store + Range-served playback.
      registerUploadRoutes(router, () => videos, unauthorized);
      registerSnapshotReadRoutes(router, () => snapshotStore);
      registerEventLogRoutes(router, () => eventLog);
      registerPushRoutes(
        router,
        { getStore: () => pushStore, vapidPublicKey: () => vapidPublicKey },
        unauthorized,
      );
      // Operational config (Frigate, anchor watch, auto-trigger, visual-MOB, hardware-tier) — owned by
      // the web app. Saving persists + restarts the plugin (which re-wires every subsystem cleanly).
      registerConfigRoutes(
        router,
        {
          getConfig: () => (started ? currentConfig : null),
          applyConfig: (next) => {
            currentConfig = next;
            pluginRestart?.(next);
          },
        },
        unauthorized,
      );

      // Cached Frigate clips: read-only list + Range-served playback (same-origin).
      registerFrigateClipRoutes(router, { getStore: () => frigateClips });

      // Capture a telemetry-stamped snapshot (position/heading/… from the Signal K bus burned into
      // the stored frame's sidecar). Same-origin and keyed by a known camera id.
      router.post('/cameras/:id/snapshot', async (req: Request, res: Response) => {
        if (unauthorized(req, res)) return;
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
      registerRecordingRoutes(
        router,
        {
          getManager: () => recordings,
          hasCamera: (id: string) => cameras?.get(id) !== null && cameras?.get(id) !== undefined,
          listSegments: () => (recordingsDir ? scanRecordings(recordingsDir) : []),
        },
        unauthorized,
      );

      // Incident bundles: trigger, list, manifest, Range-served assets, patch + delete.
      registerIncidentRoutes(
        router,
        {
          getController: () => incidents,
          getStore: () => incidentStore,
        },
        unauthorized,
      );

      // Connection test for an unsaved camera (ffprobe / TCP reachability, SSRF-guarded).
      registerTestRoutes(router, {
        ready: () => cameras !== null,
        assertHostAllowed: (host) => assertHostAllowed(host, ssrfOptions, lookup),
        runFfprobe,
        tcpProbe,
        rateLimit,
        gate: unauthorized,
      });
    },
  };

  return plugin;
};
