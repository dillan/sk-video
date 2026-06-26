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
  void store;
  // RED stub.
  return {
    async listResources() {
      throw new Error('not implemented');
    },
    async getResource() {
      throw new Error('not implemented');
    },
    async setResource() {
      throw new Error('not implemented');
    },
    async deleteResource() {
      throw new Error('not implemented');
    }
  };
}
