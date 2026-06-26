import type { Plugin, ServerAPI } from '@signalk/server-api';
import type { IRouter, Request, Response } from 'express';
import { promises as dns } from 'node:dns';
import { CameraStore } from './cameras/camera-store';
import { CredentialStore } from './cameras/credential-store';
import { FileCameraPersistence, FileCredentialPersistence } from './cameras/file-persistence';
import { createCameraResourceMethods } from './cameras/resource-provider';
import { validateCamera } from './cameras/camera-validation';
import { assertHostAllowed, type ISsrfOptions } from './security/ssrf-guard';

const PLUGIN_ID = 'sk-video';

export = function (app: ServerAPI): Plugin {
  let cameras: CameraStore | null = null;
  let credentials: CredentialStore | null = null;

  // Cameras live on the LAN, so private ranges are allowed; loopback, link-local and the
  // cloud-metadata address are always blocked by the SSRF guard.
  const ssrfOptions: ISsrfOptions = { allowPrivate: true };
  const lookup = async (host: string): Promise<string[]> =>
    (await dns.lookup(host, { all: true })).map((a) => a.address);

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

        const base = createCameraResourceMethods(cameras);
        app.registerResourceProvider({
          type: 'cameras',
          methods: {
            ...base,
            // Validate and SSRF-check the camera host before storing it, so a camera definition can
            // never point the gateway at loopback, link-local or the cloud-metadata address.
            async setResource(id: string, value: Record<string, unknown>) {
              const result = validateCamera(value);
              if (result.valid && result.value) {
                await assertHostAllowed(result.value.source.host, ssrfOptions, lookup);
              }
              await base.setResource(id, value);
            }
          }
        });

        const count = Object.keys(cameras.list()).length;
        app.setPluginStatus(`Ready — ${count} camera${count === 1 ? '' : 's'} configured`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        app.error?.(`[sk-video] failed to start: ${message}`);
        app.setPluginError(`Failed to start: ${message}`);
      }
    },

    stop() {
      cameras = null;
      credentials = null;
    },

    registerWithRouter(router: IRouter) {
      // GET /plugins/sk-video/status
      router.get('/status', (_req: Request, res: Response) => {
        res.json({
          ready: cameras !== null,
          cameras: cameras ? Object.keys(cameras.list()).length : 0
        });
      });

      // Write-only camera credentials — set/clear, never returned to the client.
      router.post('/cameras/:id/credentials', (req: Request, res: Response) => {
        if (!credentials) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        try {
          credentials.set(String(req.params.id), (req.body as unknown) ?? {});
          res.status(204).end();
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : 'invalid credentials' });
        }
      });

      router.delete('/cameras/:id/credentials', (req: Request, res: Response) => {
        if (!credentials) {
          res.status(503).json({ error: 'plugin not started' });
          return;
        }
        const existed = credentials.delete(String(req.params.id));
        res.status(existed ? 204 : 404).end();
      });
    }
  };

  return plugin;
};
