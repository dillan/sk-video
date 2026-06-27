/**
 * Reads go2rtc's /api/streams introspection for one camera and maps it to a minimal, safe health DTO
 * (online / producer + consumer counts / negotiated codecs / redacted source URLs). go2rtc's JSON is
 * NOT a stable contract — it is pinned to GO2RTC_VERSION and parsed defensively, tolerating drift and
 * never throwing on shape. This is a diagnostic hint ("why is this feed black?"), not an SLA monitor:
 * go2rtc connects to a source lazily, so a healthy camera with no current viewer reads as not-online.
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface IStreamHealth {
  /** A producer (source connection) is currently active in go2rtc. */
  online: boolean;
  producers: number;
  consumers: number;
  /** Negotiated codec names, e.g. ["H264", "PCMA"]. */
  codecs: string[];
  /** Producer source URLs with any credentials redacted. */
  sources: string[];
}

export function parseStreamHealth(_raw: unknown, _cameraId: string): IStreamHealth {
  return { online: false, producers: 0, consumers: 0, codecs: [], sources: [] };
}

export async function fetchStreamHealth(_opts: {
  apiPort: number;
  cameraId: string;
  fetchImpl?: typeof fetch;
}): Promise<IStreamHealth> {
  return { online: false, producers: 0, consumers: 0, codecs: [], sources: [] };
}
