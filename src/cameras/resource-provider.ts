import { CameraStore } from './camera-store';

/** The subset of the Signal K ResourceProvider method contract this plugin implements. */
export interface ICameraResourceMethods {
  listResources(query: Record<string, unknown>): Promise<Record<string, unknown>>;
  getResource(id: string, property?: string): Promise<object>;
  setResource(id: string, value: Record<string, unknown>): Promise<void>;
  deleteResource(id: string): Promise<void>;
}

/**
 * Adapts a CameraStore to the Signal K Resource Provider method contract so camera definitions are
 * served at `/signalk/v2/api/resources/cameras`. Custom resource types are not validated by the
 * server, so validation happens in the store.
 */
export function createCameraResourceMethods(store: CameraStore): ICameraResourceMethods {
  return {
    async listResources() {
      return store.list();
    },
    async getResource(id: string, property?: string) {
      const camera = store.get(id);
      if (!camera) {
        throw new Error(`camera "${id}" not found`);
      }
      if (property === undefined || property === '') {
        return camera;
      }
      // Dot-notation drill-down (GET /resources/cameras/<id>/source/scheme) per the
      // ResourceProvider contract; unknown properties reject like unknown ids do.
      let value: unknown = camera;
      for (const segment of property.split('.')) {
        if (!value || typeof value !== 'object' || !(segment in (value as object))) {
          throw new Error(`camera "${id}" has no property "${property}"`);
        }
        value = (value as Record<string, unknown>)[segment];
      }
      return { value };
    },
    async setResource(id: string, value: Record<string, unknown>) {
      store.set(id, value);
    },
    async deleteResource(id: string) {
      if (!store.delete(id)) {
        throw new Error(`camera "${id}" not found`);
      }
    },
  };
}
