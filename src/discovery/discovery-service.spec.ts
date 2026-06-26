import { describe, it, expect, vi } from "vitest";
import {
  DiscoveryService,
  ScanThrottledError,
  type DiscoveryProbe,
} from "./discovery-service";
import { ScanThrottle } from "./scan-throttle";
import type { IRawDiscovery } from "./normalize";

const probeOf =
  (...hits: IRawDiscovery[]): DiscoveryProbe =>
  () =>
    Promise.resolve(hits);

describe("DiscoveryService", () => {
  it("merges, normalizes and dedupes hits from every probe", async () => {
    const svc = new DiscoveryService({
      probes: [
        probeOf({ hostname: "10.0.0.5", port: 80, name: "mDNS Cam" }),
        probeOf({
          xaddr: "http://10.0.0.5:80/onvif/device_service",
          name: "ONVIF Cam",
        }),
      ],
    });
    const found = await svc.scan();
    expect(found).toHaveLength(1); // same host:port collapses to one
    expect(found[0].onvifUrl).toBe("http://10.0.0.5:80/onvif/device_service"); // richer hit wins
  });

  it("passes the per-scan timeout to each probe", async () => {
    const probe = vi.fn<DiscoveryProbe>().mockResolvedValue([]);
    await new DiscoveryService({ probes: [probe], timeoutMs: 1234 }).scan();
    expect(probe).toHaveBeenCalledWith(1234);
  });

  it("keeps going when one probe rejects", async () => {
    const svc = new DiscoveryService({
      probes: [
        () => Promise.reject(new Error("mdns blew up")),
        probeOf({ hostname: "cam.local" }),
      ],
    });
    const found = await svc.scan();
    expect(found.map((c) => c.host)).toEqual(["cam.local"]);
  });

  it("caps the number of returned candidates", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      hostname: `10.0.0.${i}`,
    }));
    const svc = new DiscoveryService({
      probes: [probeOf(...many)],
      maxResults: 3,
    });
    expect(await svc.scan()).toHaveLength(3);
  });

  it("rejects a concurrent scan via the throttle", async () => {
    const svc = new DiscoveryService({
      probes: [probeOf({ hostname: "a" })],
      cooldownMs: 60000,
    });
    await svc.scan();
    await expect(svc.scan()).rejects.toBeInstanceOf(ScanThrottledError);
  });

  it("releases the throttle after a probe throws so later scans can run", async () => {
    let t = 0;
    const throttle = new ScanThrottle(1000, () => t);
    const svc = new DiscoveryService({
      probes: [() => Promise.reject(new Error("boom"))],
      throttle,
    });
    await svc.scan();
    t += 1000; // let the cooldown elapse
    await expect(svc.scan()).resolves.toEqual([]); // not stuck "in flight"
  });
});
