import { describe, it, expect } from 'vitest';
import { buildOpenApiDoc } from './openapi';
import { CAMERA_SCHEMES } from '../cameras/camera-validation';

type Doc = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
  components: { schemas: Record<string, unknown> };
};

describe('buildOpenApiDoc', () => {
  const doc = buildOpenApiDoc() as Doc;

  it('is an OpenAPI 3 document rooted at the plugin mount', () => {
    expect(doc.openapi.startsWith('3.')).toBe(true);
    expect(doc.info.title).toMatch(/SK Video/);
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+/); // the real package version, not a stub
    expect(doc.servers).toEqual([{ url: '/plugins/sk-video' }]);
  });

  it('covers the load-bearing route groups', () => {
    for (const path of [
      '/status',
      '/session',
      '/cameras',
      '/cameras/{id}/credentials',
      '/cameras/{id}/whep',
      '/cameras/{id}/stream.m3u8',
      '/cameras/{id}/frame.jpeg',
      '/cameras/{id}/health',
      '/cameras/{id}/transport',
      '/cameras/{id}/ptz',
      '/cameras/{id}/record',
      '/cameras/discover',
      '/recordings',
      '/incidents',
      '/events/log',
      '/notifications/ack',
      '/operational-config',
      '/videos',
      '/mob',
    ]) {
      expect(doc.paths[path], `missing ${path}`).toBeTruthy();
    }
  });

  it('gives every operation a summary and a tag so the Admin UI browser is navigable', () => {
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (method === 'parameters') continue;
        expect(op.summary, `${method.toUpperCase()} ${path} has no summary`).toBeTruthy();
        expect(op.tags?.length, `${method.toUpperCase()} ${path} has no tag`).toBeGreaterThan(0);
      }
    }
  });

  it('publishes the camera resource document schema (custom types get no server validation)', () => {
    const camera = doc.components.schemas.Camera as {
      properties: {
        source: { properties: { scheme: { enum: string[] } } };
      };
      required?: string[];
    };
    expect(camera).toBeTruthy();
    expect(camera.properties.source.properties.scheme.enum).toEqual([...CAMERA_SCHEMES]);
  });

  it('documents the write-only credential contract instead of pretending secrets are readable', () => {
    const credentials = doc.paths['/cameras/{id}/credentials'];
    expect(JSON.stringify(credentials)).toMatch(/write-only/i);
  });
});
