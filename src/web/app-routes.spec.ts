import { describe, it, expect, vi } from 'vitest';
import type { IRouter, Request, Response } from 'express';
import { registerAppRoutes, resolveAssetPath, contentTypeFor } from './app-routes';

/** Capture the middleware registered via router.use('/app', mw). */
function fakeRouter() {
  let mw: ((req: Request, res: Response, next: () => void) => void) | undefined;
  const router = {
    use: (path: string, handler: (req: Request, res: Response, next: () => void) => void) => {
      if (path === '/app') mw = handler;
    },
  } as unknown as IRouter;
  return {
    router,
    call: (req: Partial<Request>, next: () => void = () => undefined) => {
      const res = makeRes();
      mw!({ method: 'GET', path: '/', ...req } as Request, res as unknown as Response, next);
      return res;
    },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as Buffer | undefined,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(chunk?: Buffer) {
      this.body = chunk;
      this.ended = true;
      return this;
    },
  };
}

describe('resolveAssetPath', () => {
  it('maps the app root and directory paths to index.html', () => {
    expect(resolveAssetPath('/')).toBe('index.html');
    expect(resolveAssetPath('')).toBe('index.html');
    expect(resolveAssetPath('/assets/')).toBe('assets/index.html');
  });

  it('returns a clean relative path for a real asset', () => {
    expect(resolveAssetPath('/assets/main-abc123.js')).toBe('assets/main-abc123.js');
    expect(resolveAssetPath('/favicon.svg')).toBe('favicon.svg');
  });

  it('rejects path traversal, even percent-encoded', () => {
    expect(resolveAssetPath('/../secret')).toBeNull();
    expect(resolveAssetPath('/assets/../../etc/passwd')).toBeNull();
    expect(resolveAssetPath('/%2e%2e/secret')).toBeNull();
    expect(resolveAssetPath('/a/%2e%2e%2fb')).toBeNull();
  });

  it('rejects NUL bytes and undecodable input', () => {
    expect(resolveAssetPath('/a\0b')).toBeNull();
    expect(resolveAssetPath('/%')).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it('maps known extensions', () => {
    expect(contentTypeFor('index.html')).toMatch(/text\/html/);
    expect(contentTypeFor('assets/x.js')).toMatch(/javascript/);
    expect(contentTypeFor('assets/x.css')).toMatch(/text\/css/);
    expect(contentTypeFor('icon.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('app.webmanifest')).toMatch(/manifest/);
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentTypeFor('mystery.xyz')).toBe('application/octet-stream');
  });
});

describe('registerAppRoutes', () => {
  const bundle: Record<string, Buffer> = {
    'index.html': Buffer.from('<!doctype html><div id=root>'),
    'assets/main-abc.js': Buffer.from('console.log(1)'),
  };
  const deps = { readAsset: (rel: string) => bundle[rel] ?? null };

  it('serves index.html at the app root with no-store', () => {
    const { router, call } = fakeRouter();
    registerAppRoutes(router, deps);
    const res = call({ path: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.body?.toString()).toContain('id=root');
  });

  it('serves a hashed asset as immutable', () => {
    const { router, call } = fakeRouter();
    registerAppRoutes(router, deps);
    const res = call({ path: '/assets/main-abc.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/javascript/);
    expect(res.headers['Cache-Control']).toContain('immutable');
  });

  it('falls back to index.html for an extension-less client route', () => {
    const { router, call } = fakeRouter();
    registerAppRoutes(router, deps);
    const res = call({ path: '/live/foredeck' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('404s a missing asset that looks like a real file (does not mask it as the SPA)', () => {
    const { router, call } = fakeRouter();
    registerAppRoutes(router, deps);
    const res = call({ path: '/assets/missing.js' });
    expect(res.statusCode).toBe(404);
  });

  it('400s a traversal attempt', () => {
    const { router, call } = fakeRouter();
    registerAppRoutes(router, deps);
    const res = call({ path: '/../secret' });
    expect(res.statusCode).toBe(400);
  });

  it('passes non-GET/HEAD requests through to the next handler', () => {
    const { router, call } = fakeRouter();
    registerAppRoutes(router, deps);
    const next = vi.fn();
    const res = call({ method: 'POST', path: '/' }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.ended).toBe(false);
  });

  it('answers HEAD with headers but no body', () => {
    const { router, call } = fakeRouter();
    registerAppRoutes(router, deps);
    const res = call({ method: 'HEAD', path: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    expect(res.body).toBeUndefined();
  });

  it('404s when the bundle is missing entirely (not built)', () => {
    const { router, call } = fakeRouter();
    registerAppRoutes(router, { readAsset: () => null });
    const res = call({ path: '/' });
    expect(res.statusCode).toBe(404);
  });
});
