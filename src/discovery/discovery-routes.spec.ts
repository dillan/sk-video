import { describe, it, expect, vi } from "vitest";
import type { IRouter, Request, Response } from "express";
import { registerDiscoveryRoutes } from "./discovery-routes";
import { DiscoveryService, ScanThrottledError } from "./discovery-service";

/** A fake router that captures the GET handler so we can invoke it directly. */
function fakeRouter() {
  let handler: ((req: Request, res: Response) => void) | undefined;
  const router = {
    get: (_path: string, h: (req: Request, res: Response) => void) => {
      handler = h;
    },
  } as unknown as IRouter;
  return { router, invoke: () => handler!({} as Request, makeRes()) };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  };
}

describe("registerDiscoveryRoutes", () => {
  it("returns 503 when the plugin is not started", async () => {
    const { router } = fakeRouter();
    let captured!: (req: Request, res: Response) => void;
    (router.get as unknown as (p: string, h: typeof captured) => void) = (
      _p,
      h,
    ) => (captured = h);
    registerDiscoveryRoutes(router, () => null);
    const res = makeRes();
    captured({} as Request, res);
    expect(res.statusCode).toBe(503);
  });

  it("returns the discovered cameras on success", async () => {
    const svc = {
      scan: vi.fn().mockResolvedValue([{ name: "Cam", host: "10.0.0.1" }]),
    };
    const { router } = fakeRouter();
    let captured!: (req: Request, res: Response) => void;
    (router.get as unknown as (p: string, h: typeof captured) => void) = (
      _p,
      h,
    ) => (captured = h);
    registerDiscoveryRoutes(router, () => svc as unknown as DiscoveryService);
    const res = makeRes();
    captured({} as Request, res);
    await vi.waitFor(() =>
      expect(res.body).toEqual({
        cameras: [{ name: "Cam", host: "10.0.0.1" }],
      }),
    );
  });

  it("returns 429 with Retry-After when rate-limited", async () => {
    const svc = {
      scan: vi.fn().mockRejectedValue(new ScanThrottledError(8000)),
    };
    const { router } = fakeRouter();
    let captured!: (req: Request, res: Response) => void;
    (router.get as unknown as (p: string, h: typeof captured) => void) = (
      _p,
      h,
    ) => (captured = h);
    registerDiscoveryRoutes(router, () => svc as unknown as DiscoveryService);
    const res = makeRes();
    captured({} as Request, res);
    await vi.waitFor(() => expect(res.statusCode).toBe(429));
    expect(res.headers["Retry-After"]).toBe("8");
  });
});
