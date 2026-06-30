import type { IRouter, Request, Response } from 'express';

/**
 * Serves the SK Video web app (the built Vite/React bundle in the package's `public/` dir) same-origin
 * under `/plugins/sk-video/app/`, alongside — never shadowing — the plugin's HTTP API. Hashed assets
 * are immutable; `index.html` is `no-store` so a redeploy is picked up; unknown extension-less paths
 * fall back to `index.html` (SPA routing). Path resolution rejects traversal so a request can never
 * escape the public dir. The file read is injected (`deps.readAsset`) so the routing, caching, and
 * traversal logic is unit-tested without touching the filesystem.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function contentTypeFor(relPath: string): string {
  const dot = relPath.lastIndexOf('.');
  const ext = dot >= 0 ? relPath.slice(dot).toLowerCase() : '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Resolve a request sub-path (the part under `/app`) to a safe relative asset path, or `null` if it
 * escapes the app root. Empty/directory paths resolve to `index.html`. Rejects undecodable input,
 * NUL bytes, and any `.`/`..` segment (including percent-encoded forms).
 */
export function resolveAssetPath(subPath: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(subPath);
  } catch {
    return null;
  }
  if (p.includes('\0')) {
    return null;
  }
  p = p.split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (p === '' || p.endsWith('/')) {
    p = `${p}index.html`;
  }
  const segments = p.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return null;
  }
  return segments.join('/');
}

export interface IAppRoutesDeps {
  /** Read a vetted relative asset path under the app's public dir; `null` if it does not exist. */
  readAsset: (relPath: string) => Buffer | null;
}

const HAS_EXTENSION = /\.[a-z0-9]+$/i;

export function registerAppRoutes(router: IRouter, deps: IAppRoutesDeps): void {
  router.use('/app', (req: Request, res: Response, next: () => void) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const rel = resolveAssetPath(req.path ?? '/');
    if (rel === null) {
      res.status(400).end();
      return;
    }

    let served = rel;
    let bytes = deps.readAsset(served);
    if (bytes === null) {
      // A missing path that looks like a real file is a genuine 404; an extension-less path is a
      // client route, so fall back to the SPA entry (hash routing keeps real routes client-side,
      // and this also future-proofs history routing without shadowing the sibling API).
      if (HAS_EXTENSION.test(served)) {
        res.status(404).end();
        return;
      }
      served = 'index.html';
      bytes = deps.readAsset(served);
      if (bytes === null) {
        res.status(404).end();
        return;
      }
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', contentTypeFor(served));
    res.setHeader(
      'Cache-Control',
      served === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    );
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(bytes);
  });
}
