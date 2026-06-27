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
import { Go2rtcBinaryManager } from './gateway/go2rtc-binary-manager';
import { Go2rtcProcess } from './gateway/go2rtc-process';
import { Go2rtcGateway } from './gateway/go2rtc-gateway';
import { registerProxyRoutes } from './gateway/go2rtc-proxy-routes';
import { PtzManager } from './onvif/ptz-manager';
import { registerPtzRoutes } from './onvif/ptz-routes';
import { DiscoveryService } from './discovery/discovery-service';
import { createWsDiscoveryProbe } from './discovery/ws-discovery-probe';
import { createMdnsProbe } from './discovery/mdns-probe';
import { registerDiscoveryRoutes } from './discovery/discovery-routes';
import { AssetStore } from './uploads/asset-store';
import { createFileAssetStore } from './uploads/file-asset-store';
import { registerUploadRoutes } from './uploads/upload-routes';
import { registerTestRoutes } from './diagnostics/test-routes';
import { runFfprobe, tcpProbe } from './diagnostics/probe-runner';
import { SignalKBridge, type ISignalKApp } from './signalk/sk-bridge';
import { SnapshotService } from './recording/snapshot-service';
import { FileSnapshotStore } from './recording/file-snapshot-store';
import { go2rtcApiUrl } from './gateway/go2rtc-proxy';

const PLUGIN_ID = 'sk-video';
const SYNC_DEBOUNCE_MS = 500;

export = function (app: ServerAPI): Plugin {
  let cameras: CameraStore | null = null;
  let credentials: CredentialStore | null = null;
  let gateway: Go2rtcGateway | null = null;
  let ptz: PtzManager | null = null;
  let discovery: DiscoveryService | null = null;
  let videos: AssetStore | null = null;
  let bridge: SignalKBridge | null = null;
  let snapshots: SnapshotService | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;

  const ssrfOptions: ISsrfOptions = { allowPrivate: true };
  const lookup = async (host: string): Promise<string[]> =>
    (await dns.lookup(host, { all: true })).map((a) => a.address);
  const log = (msg: string) => app.debug?.(redactUrl(msg));

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

    schema: () => ({ type: 'object', properties: {} }),

    start() {
      try {
        const dataDir = app.getDataDirPath();
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
          probes: [createWsDiscoveryProbe(), createMdnsProbe()],
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
        app.setPluginStatus(`Ready — ${count} camera${count === 1 ? '' : 's'} configured`);
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
      ptz?.disposeAll();
      const stopping = gateway?.stop();
      cameras = null;
      credentials = null;
      gateway = null;
      ptz = null;
      discovery = null;
      videos = null;
      bridge = null;
      snapshots = null;
      return stopping;
    },

    registerWithRouter(router: IRouter) {
      router.get('/status', (_req: Request, res: Response) => {
        res.json({
          ready: cameras !== null,
          cameras: cameras ? Object.keys(cameras.list()).length : 0,
        });
      });

      // Credential presence — booleans only, never the secret — so the UI can show a saved state.
      router.get('/cameras/:id/credentials', (req: Request, res: Response) => {
        if (!credentials) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        res.json(credentials.presence(String(req.params.id)));
      });

      // Write-only camera credentials.
      router.post('/cameras/:id/credentials', (req: Request, res: Response) => {
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

      // Same-origin transport proxy to go2rtc (WHEP / frame.jpeg / HLS).
      registerProxyRoutes(router, {
        apiPort: () => gateway?.apiPort ?? 1984,
        hasCamera: (id: string) => cameras?.get(id) !== null && cameras?.get(id) !== undefined,
      });

      // ONVIF PTZ control.
      registerPtzRoutes(router, () => ptz);

      // Camera auto-discovery (WS-Discovery + mDNS), rate-limited.
      registerDiscoveryRoutes(router, () => discovery);

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

      // Connection test for an unsaved camera (ffprobe / TCP reachability, SSRF-guarded).
      registerTestRoutes(router, {
        ready: () => cameras !== null,
        assertHostAllowed: (host) => assertHostAllowed(host, ssrfOptions, lookup),
        runFfprobe,
        tcpProbe,
      });
    },
  };

  return plugin;
};
