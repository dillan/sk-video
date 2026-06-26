// Minimal ambient declaration for the parts of the `onvif` package (v0.8) this plugin uses.
// The package ships no types of its own.
declare module 'onvif' {
  export interface CamOptions {
    hostname: string;
    username?: string;
    password?: string;
    port?: number;
    timeout?: number;
  }

  export class Cam {
    constructor(options: CamOptions, callback: (err?: Error | null) => void);
    continuousMove(options: { x: number; y: number; zoom: number }, callback: (err?: Error | null) => void): void;
    stop(options: { panTilt?: boolean; zoom?: boolean }, callback: (err?: Error | null) => void): void;
    getPresets(callback: (err: Error | null, presets?: Record<string, string>) => void): void;
    gotoPreset(options: { preset: string }, callback: (err?: Error | null) => void): void;
  }

  export class Discovery {
    static probe(options: Record<string, unknown>, callback: (err: Error | null, cams: unknown[]) => void): void;
  }
}
