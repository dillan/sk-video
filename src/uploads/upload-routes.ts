import { createReadStream, type ReadStream } from "node:fs";
import type { IRouter, Request, Response } from "express";
import {
  AssetQuotaError,
  AssetRejectedError,
  isValidAssetId,
  type AssetStore,
} from "./asset-store";
import { parseRange } from "./range";

/** Absolute ceiling on a streamed upload body, independent of the per-file quota. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

type StreamFactory = (
  path: string,
  opts?: { start: number; end: number },
) => ReadStream;

export interface IUploadRouteOptions {
  /** Injectable for tests; defaults to fs.createReadStream. */
  streamFactory?: StreamFactory;
}

type BodyResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; tooLarge: boolean };

/** Streams the request body into a Buffer, aborting if it exceeds the cap. */
function readBodyBuffer(req: Request, maxBytes: number): Promise<BodyResult> {
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return Promise.resolve(
      req.body.length > maxBytes
        ? { ok: false, tooLarge: true }
        : { ok: true, bytes: req.body as Buffer },
    );
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (result: BodyResult): void => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        finish({ ok: false, tooLarge: true });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish({ ok: true, bytes: Buffer.concat(chunks) }));
    req.on("error", () => finish({ ok: false, tooLarge: false }));
  });
}

/**
 * Registers the video upload/library endpoints, keyed by an opaque id:
 *   POST   /videos       — upload a video (validated by magic bytes; quota-enforced)
 *   GET    /videos       — list stored videos
 *   GET    /videos/:id   — stream a video with HTTP Range support
 *   DELETE /videos/:id   — remove a stored video
 * The store is resolved live (created in start()), returning 503 until the plugin is started.
 */
export function registerUploadRoutes(
  router: IRouter,
  getStore: () => AssetStore | null,
  options: IUploadRouteOptions = {},
): void {
  const openStream =
    options.streamFactory ?? (createReadStream as StreamFactory);

  const requireStore = (res: Response): AssetStore | null => {
    const store = getStore();
    if (!store) {
      res.status(503).json({ error: "plugin not started" });
      return null;
    }
    return store;
  };

  router.post("/videos", (req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const name =
      typeof req.headers["x-filename"] === "string"
        ? req.headers["x-filename"]
        : undefined;
    void readBodyBuffer(req, MAX_UPLOAD_BYTES).then((body) => {
      if (!body.ok) {
        res
          .status(body.tooLarge ? 413 : 400)
          .json({ error: body.tooLarge ? "file too large" : "upload failed" });
        return;
      }
      try {
        const asset = store.add(new Uint8Array(body.bytes), name);
        res.status(201).json(asset);
      } catch (err) {
        if (err instanceof AssetRejectedError) {
          res.status(415).json({ error: err.message });
        } else if (err instanceof AssetQuotaError) {
          res.status(413).json({ error: err.message });
        } else {
          res.status(500).json({ error: "failed to store video" });
        }
      }
    });
  });

  router.get("/videos", (_req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    res.json({ videos: store.list() });
  });

  router.get("/videos/:id", (req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const id = String(req.params.id);
    if (!isValidAssetId(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const asset = store.get(id);
    if (!asset) {
      res.status(404).json({ error: "not found" });
      return;
    }

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", asset.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${asset.name}"`);
    res.setHeader("Cache-Control", "private, max-age=0");

    const range = parseRange(req.headers.range, asset.size);
    if (range.type === "unsatisfiable") {
      res.setHeader("Content-Range", `bytes */${asset.size}`);
      res.status(416).end();
      return;
    }

    const path = store.pathFor(id);
    let stream: ReadStream;
    if (range.type === "range") {
      res.status(206);
      res.setHeader(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${asset.size}`,
      );
      res.setHeader("Content-Length", String(range.end - range.start + 1));
      stream = openStream(path, { start: range.start, end: range.end });
    } else {
      res.status(200);
      res.setHeader("Content-Length", String(asset.size));
      stream = openStream(path);
    }
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.destroy();
    });
    stream.pipe(res);
  });

  router.delete("/videos/:id", (req: Request, res: Response) => {
    const store = requireStore(res);
    if (!store) {
      return;
    }
    const id = String(req.params.id);
    if (!isValidAssetId(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    res.status(store.delete(id) ? 204 : 404).end();
  });
}
