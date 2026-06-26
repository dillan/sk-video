import type { Plugin, ServerAPI } from '@signalk/server-api';
import type { IRouter, Request, Response } from 'express';
import { CameraStore } from './cameras/camera-store';
import { FileCameraPersistence } from './cameras/file-persistence';
import { createCameraResourceMethods } from './cameras/resource-provider';

const PLUGIN_ID = 'sk-video';

export = function (app: ServerAPI): Plugin {
  let store: CameraStore | null = null;

  const plugin: Plugin = {
    id: PLUGIN_ID,
    name: 'SK Video',
    description: 'IP cameras for the browser: gateway, ONVIF PTZ, discovery and uploads.',

    // No user configuration yet — camera definitions live in the `cameras` resource.
    schema: () => ({ type: 'object', properties: {} }),

    start() {
      try {
        store = new CameraStore(new FileCameraPersistence(app.getDataDirPath()));
        app.registerResourceProvider({
          type: 'cameras',
          methods: createCameraResourceMethods(store)
        });
        const count = Object.keys(store.list()).length;
        app.setPluginStatus(`Ready — ${count} camera${count === 1 ? '' : 's'} configured`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        app.error?.(`[sk-video] failed to start: ${message}`);
        app.setPluginError(`Failed to start: ${message}`);
      }
    },

    stop() {
      store = null;
    },

    registerWithRouter(router: IRouter) {
      // GET /plugins/sk-video/status
      router.get('/status', (_req: Request, res: Response) => {
        res.json({
          ready: store !== null,
          cameras: store ? Object.keys(store.list()).length : 0
        });
      });
    }
  };

  return plugin;
};
