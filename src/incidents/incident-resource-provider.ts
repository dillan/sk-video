import type { ICameraResourceMethods } from '../cameras/resource-provider';
import { validateIncidentPatch } from './incident-validation';
import type { IIncidentStore } from './incident-store';

/**
 * Adapts the incident store to the Signal K ResourceProvider method contract, served read-mostly at
 * `/signalk/v2/api/resources/incidents`. Bundles are created by triggers, NEVER by clients, so
 * setResource only patches the validated editable subset of an EXISTING bundle (no raw bytes can be
 * injected via the resource API); deleteResource refuses a pinned bundle.
 */
export function createIncidentResourceMethods(store: IIncidentStore): ICameraResourceMethods {
  return {
    async listResources() {
      return Object.fromEntries(store.list().map((b) => [b.id, b]));
    },
    async getResource(id: string) {
      const bundle = store.get(id);
      if (!bundle) {
        throw new Error(`incident "${id}" not found`);
      }
      return bundle;
    },
    async setResource(id: string, value: Record<string, unknown>) {
      const result = validateIncidentPatch(value);
      if (!result.valid || !result.value) {
        throw new Error(result.errors.join('; ') || 'invalid incident patch');
      }
      if (!store.patch(id, result.value)) {
        throw new Error(`incident "${id}" not found`);
      }
    },
    async deleteResource(id: string) {
      const bundle = store.get(id);
      if (!bundle) {
        throw new Error(`incident "${id}" not found`);
      }
      if (bundle.pinned) {
        throw new Error(`incident "${id}" is pinned`);
      }
      store.delete(id);
    },
  };
}
