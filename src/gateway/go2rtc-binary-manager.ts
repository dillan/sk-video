import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import {
  GO2RTC_VERSION,
  go2rtcAssetName,
  go2rtcDownloadUrl,
  isZipAsset,
  verifySha256,
} from './go2rtc-binary';

/** Extracts the go2rtc binary from a release zip archive (macOS/Windows). */
function extractBinaryFromZip(zipData: Buffer): Buffer {
  const entry = new AdmZip(zipData)
    .getEntries()
    .find((e) => !e.isDirectory && /(^|\/)go2rtc(\.exe)?$/i.test(e.entryName));
  if (!entry) {
    throw new Error('go2rtc binary not found in the downloaded archive');
  }
  return entry.getData();
}

export interface IGo2rtcBinaryOptions {
  /** Where to store / look for the binary (the plugin data directory). */
  dataDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Injectable fetch for testing. */
  fetchImpl?: typeof fetch;
  /** Optional pinned SHA-256 (hex) to verify the download against. */
  expectedSha256?: string;
  log?: (msg: string) => void;
}

/**
 * Locates the go2rtc binary, downloading it on first use. A binary already present in the data dir
 * (downloaded earlier, or placed there manually for offline installs) is used as-is. Downloads come
 * over HTTPS from the pinned official release and are made executable; if a SHA-256 is configured the
 * download is verified against it.
 */
export class Go2rtcBinaryManager {
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly dataDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly expectedSha256?: string;
  private readonly log: (msg: string) => void;

  constructor(opts: IGo2rtcBinaryOptions) {
    this.platform = opts.platform ?? process.platform;
    this.arch = opts.arch ?? process.arch;
    this.dataDir = opts.dataDir;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.expectedSha256 = opts.expectedSha256;
    this.log = opts.log ?? (() => undefined);
  }

  get binaryPath(): string {
    const ext = this.platform === 'win32' ? '.exe' : '';
    return join(this.dataDir, `go2rtc${ext}`);
  }

  async ensure(): Promise<string> {
    if (existsSync(this.binaryPath)) {
      return this.binaryPath;
    }
    const url = go2rtcDownloadUrl(GO2RTC_VERSION, this.platform, this.arch);
    if (!url) {
      throw new Error(
        `go2rtc has no published binary for ${this.platform}/${this.arch} — place one at ${this.binaryPath}`,
      );
    }
    this.log(`downloading go2rtc ${GO2RTC_VERSION} for ${this.platform}/${this.arch}`);
    const res = await this.fetchImpl(url, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`go2rtc download failed: HTTP ${res.status}`);
    }
    const download = Buffer.from(await res.arrayBuffer());
    if (this.expectedSha256 && !verifySha256(download, this.expectedSha256)) {
      throw new Error('go2rtc download failed SHA-256 verification');
    }
    const asset = go2rtcAssetName(this.platform, this.arch);
    const binary = asset && isZipAsset(asset) ? extractBinaryFromZip(download) : download;

    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.binaryPath, binary);
    if (this.platform !== 'win32') {
      chmodSync(this.binaryPath, 0o755);
    }
    return this.binaryPath;
  }
}
