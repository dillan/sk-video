import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { Go2rtcBinaryManager } from './go2rtc-binary-manager';

function fakeFetch(body: string, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  })) as unknown as typeof fetch;
}

describe('Go2rtcBinaryManager', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skv-bin-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('downloads the binary when missing and makes it available', async () => {
    let calledUrl = '';
    const fetchImpl = (async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('BINARY').buffer,
      };
    }) as unknown as typeof fetch;

    const mgr = new Go2rtcBinaryManager({
      dataDir: dir,
      platform: 'linux',
      arch: 'x64',
      fetchImpl,
    });
    const path = await mgr.ensure();

    expect(calledUrl).toContain('/releases/download/v');
    expect(calledUrl).toContain('go2rtc_linux_amd64');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('BINARY');
  });

  it('extracts the binary from a zip archive (macOS/Windows assets)', async () => {
    const zip = new AdmZip();
    zip.addFile('go2rtc', Buffer.from('MAC-BINARY'));
    const zipBuf = zip.toBuffer();
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength),
    })) as unknown as typeof fetch;

    const mgr = new Go2rtcBinaryManager({
      dataDir: dir,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl,
    });
    const path = await mgr.ensure();
    expect(readFileSync(path, 'utf8')).toBe('MAC-BINARY');
  });

  it('uses an already-present (manually placed) binary without downloading', async () => {
    const mgr = new Go2rtcBinaryManager({
      dataDir: dir,
      platform: 'linux',
      arch: 'x64',
      fetchImpl: fakeFetch('SHOULD-NOT-RUN'),
    });
    writeFileSync(mgr.binaryPath, 'PRE-PLACED');
    const path = await mgr.ensure();
    expect(readFileSync(path, 'utf8')).toBe('PRE-PLACED');
  });

  it('throws on an unsupported platform', async () => {
    const mgr = new Go2rtcBinaryManager({
      dataDir: dir,
      platform: 'sunos',
      arch: 'sparc',
      fetchImpl: fakeFetch('x'),
    });
    await expect(mgr.ensure()).rejects.toThrow(/no published binary/);
  });

  it('rejects a download that fails SHA-256 verification', async () => {
    const mgr = new Go2rtcBinaryManager({
      dataDir: dir,
      platform: 'linux',
      arch: 'x64',
      fetchImpl: fakeFetch('TAMPERED'),
      expectedSha256: '0'.repeat(64),
    });
    await expect(mgr.ensure()).rejects.toThrow(/SHA-256/);
  });
});
