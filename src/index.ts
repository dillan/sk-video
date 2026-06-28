import type { Plugin, ServerAPI } from '@signalk/server-api';
import type { IRouter, Request, Response } from 'express';
import { promises as dns } from 'node:dns';
import { CameraStore } from './cameras/camera-store';
import { CredentialStore } from './cameras/credential-store';
import { FileCameraPersistence, FileCredentialPersistence } from './cameras/file-persistence';
import { createCameraResourceMethods } from './cameras/resource-provider';
import { validateCamera } from './cameras/camera-validation';
import { assertHostAllowed, type ISsrfOptions } from './security/ssrf-guard';
import { redactUrl } from './security/redact';
import { RateLimiter } from './security/rate-limit';
import { withTimeout } from './security/with-timeout';
import { Go2rtcBinaryManager } from './gateway/go2rtc-binary-manager';
import { Go2rtcProcess } from './gateway/go2rtc-process';
import { Go2rtcGateway } from './gateway/go2rtc-gateway';
import { registerProxyRoutes } from './gateway/go2rtc-proxy-routes';
import { PtzManager } from './onvif/ptz-manager';
import { registerPtzRoutes } from './onvif/ptz-routes';
import { DiscoveryService } from './discovery/discovery-service';
import { createWsDiscoveryProbe } from './discovery/ws-discovery-probe';
import { createMdnsProbe } from './discovery/mdns-probe';
import { createSsdpProbe } from './discovery/ssdp-probe';
import { registerDiscoveryRoutes } from './discovery/discovery-routes';
import { registerIntrospectRoute } from './discovery/introspect-routes';
import { introspectOnvifCamera } from './onvif/onvif-introspect';
import { MobController } from './safety/mob-controller';
import { toMobCamera, ownShipFromSelfState, findMobBeacon } from './safety/mob-wiring';
import { AssetStore } from './uploads/asset-store';
import { createFileAssetStore } from './uploads/file-asset-store';
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
import { SignalKBridge, type ISignalKApp } from './signalk/sk-bridge';
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
import { rmSync, writeFileSync } from 'node:fs';
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
// Incident bundles: pre/post-roll clip + telemetry track + snapshots around an event.
const INCIDENT_DEFAULT_PRE_MS = 15_000;
const INCIDENT_DEFAULT_POST_MS = 15_000;
const INCIDENT_SAMPLE_INTERVAL_MS = 2000;
// Give the DVR a moment to close the segment covering the end of the post-roll before cutting.
const INCIDENT_FINALIZE_GRACE_MS = 2000;
// One auto-triggered bundle per notification path per minute, so a flapping alarm can't spam.
const INCIDENT_TRIGGER_COOLDOWN_MS = 60_000;
const INCIDENT_SWEEP_MS = 5 * 60 * 1000;
// A retention budget for the incidents subtree, independent of the DVR/upload budgets. Pinned
// bundles are never pruned.
const INCIDENT_QUOTA: IBundleQuota = {
  maxBytes: 5 * 1024 * 1024 * 1024, // 5 GiB
  maxCount: 200,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};

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
  const triggerState: ITriggerState = { lastFiredAtByKey: {} };
  // Cameras this MOB event started recording, so deactivation stops exactly those (and not a
  // camera the operator was already manually recording).
  let mobRecording: string[] = [];
  let mob: MobController | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (!gateway || !cameras || !credentials) {
      return;
    }
    try {
      await gateway.sync(cameras.list(), credentials.all());
    } catch (err) {
      app.setPluginError(
        redactUrl(`Gateway error: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  /** Coalesce rapid camera/credential changes into a single gateway reconcile. */
  function scheduleSync(): void {
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(() => void runSync(), SYNC_DEBOUNCE_MS);
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
      },
    }),

    start(options?: { hardwareTier?: string; autoTriggerPath?: string }) {
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
          store: new FileSnapshotStore(dataDir),
        });

        // DVR: per-camera ffmpeg recorders remux go2rtc's loopback RTSP restream into rotating MP4
        // segments. Channel-capped to the hardware tier and pruned to a byte/age budget. Credentials
        // live only in go2rtc's source config — the recorder reads the unauthenticated loopback
        // restream, so no secret ever lands in a segment path or filename.
        recordingsDir = join(dataDir, 'recordings');
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
              .catch(() => undefined);
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
            mobRecording = ids.filter((id) => recordings?.start(id));
          },
          stopRecording: () => {
            for (const id of mobRecording) {
              recordings?.stop(id);
            }
            mobRecording = [];
          },
        });

        // A Signal K PUT action so any client (a KIP button, a mapped hardware key) can trigger MOB.
        bridge.registerAction('cameras.mob.activate', (value) => {
          if (value === false) {
            mob?.deactivate();
          } else {
            mob?.activate();
          }
          return { state: 'COMPLETED', statusCode: 200 };
        });

        // Incident bundles: on a trigger, cut a pre/post-roll clip per camera from the DVR segments,
        // package them with a sampled telemetry track + stamped snapshots into one atomic bundle.
        // bridge/snapshots are non-null here; capture locals so the closures never null-check.
        const skBridge = bridge;
        const snapshotService = snapshots;
        incidentStore = new FileIncidentStore(dataDir);
        incidentStore.sweepStaging(); // drop any staging dir orphaned by an earlier crash
        const clipProducer = createFfmpegClipProducer({
          spawn: (args) => spawn('ffmpeg', args, { stdio: 'ignore' }),
          writeFile: (path, data) => writeFileSync(path, data, { mode: 0o600 }),
          readFile: (path) => fsReadFile(path),
          removeFile: (path) => rmSync(path, { force: true }),
          tmpDir: () => tmpdir(),
        });
        incidents = new IncidentController({
          store: incidentStore,
          captureSnapshot: (id) => snapshotService.captureBytes(id),
          produceClip: clipProducer,
          listSegments: () => (recordingsDir ? scanRecordings(recordingsDir) : []),
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
          incidents?.mark({ ...(parsed.value ?? { preMs: 0, postMs: 0 }), source: 'manual' });
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

        const base = createCameraResourceMethods(cameras);
        app.registerResourceProvider({
          type: 'cameras',
          methods: {
            ...base,
            async setResource(id: string, value: Record<string, unknown>) {
              const result = validateCamera(value);
              if (result.valid && result.value) {
                await assertHostAllowed(result.value.source.host, ssrfOptions, lookup);
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
      // Tear down the notification subscription BEFORE the bridge is dropped — a leaked Bacon
      // subscription would survive a plugin restart and double-fire.
      incidentUnsub?.();
      incidentUnsub = null;
      incidents?.cancelAll(); // clears finalize/sampler timers so none fire after stop()
      triggerState.lastFiredAtByKey = {};
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
          res.json({ active: false });
          return;
        }
        res.json(mob.activate());
      });

      // Same-origin transport proxy to go2rtc (WHEP / frame.jpeg / HLS).
      registerProxyRoutes(router, {
        apiPort: () => gateway?.apiPort ?? 1984,
        hasCamera: (id: string) => cameras?.get(id) !== null && cameras?.get(id) !== undefined,
      });

      // ONVIF PTZ control.
      registerPtzRoutes(router, () => ptz);

      // Camera auto-discovery (WS-Discovery + mDNS), rate-limited.
      registerDiscoveryRoutes(router, () => discovery);

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
