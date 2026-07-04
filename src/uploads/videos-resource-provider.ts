import type { ICameraResourceMethods } from '../cameras/resource-provider';
import type { AssetStore } from './asset-store';

/**
 * Adapts the uploaded-video asset store to the Signal K ResourceProvider contract, served
 * read-mostly at `/signalk/v2/api/resources/videos`. Every client on the boat sees the same video
 * library — list, fetch one entry's metadata (dot-notation drill-down works), and delete — without
 * knowing sk-video's private HTTP API. Uploads deliberately stay on the binary route: a magic-byte
 * sniff, the quota model, and streaming-to-disk cannot ride a JSON resource PUT, so setResource is
 * refused. The playable bytes are at `/plugins/sk-video/videos/<id>` (Range-served).
 */
export function createVideoResourceMethods(store: AssetStore): ICameraResourceMethods {
  return {
    async listResources() {
      return Object.fromEntries(store.list().map((v) => [v.id, v]));
    },
    async getResource(id: string, property?: string) {
      const asset = store.get(id);
      if (!asset) {
        throw new Error(`video "${id}" not found`);
      }
      if (property === undefined || property === '') {
        return asset;
      }
      let value: unknown = asset;
      for (const segment of property.split('.')) {
        if (!value || typeof value !== 'object' || !(segment in (value as object))) {
          throw new Error(`video "${id}" has no property "${property}"`);
        }
        value = (value as Record<string, unknown>)[segment];
      }
      return { value };
    },
    async setResource() {
      // Videos are binary: an upload must be sniffed, quota-checked and streamed to disk, which a
      // JSON resource write cannot do. Use POST /plugins/sk-video/videos (or the resumable session).
      throw new Error(
        'videos cannot be uploaded through the resource API; use the upload endpoint',
      );
    },
    async deleteResource(id: string) {
      if (!store.delete(id)) {
        throw new Error(`video "${id}" not found`);
      }
    },
  };
}
