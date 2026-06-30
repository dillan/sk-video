// Minimal ambient declaration for the parts of the `onvif` package (v0.8) this plugin uses.
// The package ships no types of its own.
declare module 'onvif' {
  export interface CamOptions {
    hostname: string;
    username?: string;
    password?: string;
    port?: number;
    timeout?: number;
    /** Use https for the ONVIF SOAP transport. */
    useSecure?: boolean;
    /** TLS options (e.g. `{ rejectUnauthorized: false }` to accept a self-signed certificate). */
    secureOpts?: { rejectUnauthorized?: boolean };
  }

  export class Cam {
    constructor(options: CamOptions, callback: (err?: Error | null) => void);
    continuousMove(
      options: { x: number; y: number; zoom: number },
      callback: (err?: Error | null) => void,
    ): void;
    stop(
      options: { panTilt?: boolean; zoom?: boolean },
      callback: (err?: Error | null) => void,
    ): void;
    getPresets(callback: (err: Error | null, presets?: Record<string, string>) => void): void;
    gotoPreset(options: { preset: string }, callback: (err?: Error | null) => void): void;
  }

  /** A device returned by Discovery.probe (a Cam instance enriched with discovery metadata). */
  export interface DiscoveredDevice {
    hostname?: string;
    port?: number | string;
    path?: string;
    urn?: string;
    /** Parsed XAddr URLs (legacy url.parse objects). */
    xaddrs?: Array<{
      href?: string;
      hostname?: string | null;
      port?: string | null;
    }>;
  }

  export class Discovery {
    static probe(
      options: Record<string, unknown>,
      callback: (err: Error | null, devices: DiscoveredDevice[]) => void,
    ): void;
  }
}
