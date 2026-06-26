import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCameraPersistence, FileCredentialPersistence } from './file-persistence';
import type { ICamera } from './camera-validation';
import type { ICameraCredentials } from '../gateway/go2rtc-source';

/** Owner-only (0o600) is the security contract for files at rest; skip the bit check on Windows. */
function expectOwnerOnly(file: string): void {
  if (process.platform === 'win32') return;
  expect(statSync(file).mode & 0o777).toBe(0o600);
}

const camA: ICamera = {
  name: 'Foredeck',
  enabled: true,
  source: { scheme: 'rtsp', host: 'cam.local', port: 554, path: '/stream1' },
};
const camB: ICamera = {
  name: 'Mast',
  enabled: false,
  source: { scheme: 'onvif', host: '10.0.0.9' },
};
const credA: ICameraCredentials = { username: 'admin', password: 's3cr3t!' };
const credB: ICameraCredentials = { username: 'viewer', password: '' };

describe('FileCameraPersistence', () => {
  const dirs: string[] = [];
  function freshDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'skv-test-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('load(): missing file returns an empty object', () => {
    const dir = freshDir();
    const p = new FileCameraPersistence(dir);
    expect(existsSync(join(dir, 'cameras.json'))).toBe(false);
    expect(p.load()).toEqual({});
  });

  it('load(): corrupt JSON returns an empty object instead of throwing', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'cameras.json'), '{ not valid json ,,,');
    const p = new FileCameraPersistence(dir);
    expect(p.load()).toEqual({});
  });

  it('load(): a literal JSON null returns an empty object', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'cameras.json'), 'null');
    const p = new FileCameraPersistence(dir);
    expect(p.load()).toEqual({});
  });

  it('load(): a valid object is returned as-is', () => {
    const dir = freshDir();
    const data = { foredeck: camA, mast: camB };
    writeFileSync(join(dir, 'cameras.json'), JSON.stringify(data));
    const p = new FileCameraPersistence(dir);
    expect(p.load()).toEqual(data);
  });

  it('load(): a JSON array is treated as empty, not a camera map', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'cameras.json'), JSON.stringify([camA, camB]));
    const loaded = new FileCameraPersistence(dir).load();
    // Array.isArray first: expect([]).toEqual({}) passes in vitest, so it would hide the bug.
    expect(Array.isArray(loaded)).toBe(false);
    expect(loaded).toEqual({});
  });

  it('save(): writes <dataDir>/cameras.json', () => {
    const dir = freshDir();
    const p = new FileCameraPersistence(dir);
    p.save({ foredeck: camA });
    const file = join(dir, 'cameras.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ foredeck: camA });
  });

  it('save(): writes the camera file with owner-only (0o600) permissions', () => {
    const dir = freshDir();
    new FileCameraPersistence(dir).save({ foredeck: camA });
    expectOwnerOnly(join(dir, 'cameras.json'));
  });

  it('save(): creates the data directory when it does not exist', () => {
    const dir = freshDir();
    const nested = join(dir, 'deep', 'data');
    expect(existsSync(nested)).toBe(false);
    new FileCameraPersistence(nested).save({ foredeck: camA });
    expect(existsSync(join(nested, 'cameras.json'))).toBe(true);
  });

  it('round-trips cameras through a FRESH instance (proves it hit disk)', () => {
    const dir = freshDir();
    new FileCameraPersistence(dir).save({ foredeck: camA, mast: camB });
    // A brand-new instance reads only from disk, not from any in-memory state.
    const reopened = new FileCameraPersistence(dir);
    expect(reopened.load()).toEqual({ foredeck: camA, mast: camB });
  });

  it('honours a custom filename', () => {
    const dir = freshDir();
    const p = new FileCameraPersistence(dir, 'other-cameras.json');
    p.save({ foredeck: camA });
    expect(existsSync(join(dir, 'other-cameras.json'))).toBe(true);
    expect(existsSync(join(dir, 'cameras.json'))).toBe(false);
    expect(new FileCameraPersistence(dir, 'other-cameras.json').load()).toEqual({ foredeck: camA });
  });
});

describe('FileCredentialPersistence', () => {
  const dirs: string[] = [];
  function freshDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'skv-test-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('load(): missing file returns an empty object', () => {
    const dir = freshDir();
    expect(new FileCredentialPersistence(dir).load()).toEqual({});
  });

  it('load(): corrupt JSON returns an empty object', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'credentials.json'), 'definitely : not json');
    expect(new FileCredentialPersistence(dir).load()).toEqual({});
  });

  it('load(): a literal JSON null returns an empty object', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'credentials.json'), 'null');
    expect(new FileCredentialPersistence(dir).load()).toEqual({});
  });

  it('load(): a valid object is returned as-is', () => {
    const dir = freshDir();
    const data = { foredeck: credA, mast: credB };
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify(data));
    expect(new FileCredentialPersistence(dir).load()).toEqual(data);
  });

  it('load(): a JSON array is treated as empty, not a credential map', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify([credA, credB]));
    const loaded = new FileCredentialPersistence(dir).load();
    expect(Array.isArray(loaded)).toBe(false);
    expect(loaded).toEqual({});
  });

  it('save(): writes <dataDir>/credentials.json', () => {
    const dir = freshDir();
    new FileCredentialPersistence(dir).save({ foredeck: credA });
    const file = join(dir, 'credentials.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ foredeck: credA });
  });

  // SECURITY-CRITICAL: credentials live at rest and must never be world/group-readable.
  it('save(): writes the credentials file with owner-only (0o600) permissions', () => {
    const dir = freshDir();
    new FileCredentialPersistence(dir).save({ foredeck: credA });
    expectOwnerOnly(join(dir, 'credentials.json'));
  });

  it('save(): creates the data directory when it does not exist', () => {
    const dir = freshDir();
    const nested = join(dir, 'sub', 'creds');
    new FileCredentialPersistence(nested).save({ foredeck: credA });
    expect(existsSync(join(nested, 'credentials.json'))).toBe(true);
  });

  it('round-trips credentials through a FRESH instance (proves it hit disk)', () => {
    const dir = freshDir();
    new FileCredentialPersistence(dir).save({ foredeck: credA, mast: credB });
    const reopened = new FileCredentialPersistence(dir);
    expect(reopened.load()).toEqual({ foredeck: credA, mast: credB });
  });
});

describe('camera / credential isolation over a shared dataDir', () => {
  const dirs: string[] = [];
  function freshDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'skv-test-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('writes cameras and credentials to SEPARATE files in the same directory', () => {
    const dir = freshDir();
    const cameras = new FileCameraPersistence(dir);
    const creds = new FileCredentialPersistence(dir);

    cameras.save({ foredeck: camA });
    creds.save({ foredeck: credA });

    const camFile = join(dir, 'cameras.json');
    const credFile = join(dir, 'credentials.json');
    expect(camFile).not.toBe(credFile);
    expect(existsSync(camFile)).toBe(true);
    expect(existsSync(credFile)).toBe(true);
    // The public camera file must not contain the secret payload.
    expect(readFileSync(camFile, 'utf8')).not.toContain('s3cr3t!');
    expect(readFileSync(credFile, 'utf8')).toContain('s3cr3t!');
  });

  it('saving cameras does not create or touch the credentials file (and vice versa)', () => {
    const dir = freshDir();
    new FileCameraPersistence(dir).save({ foredeck: camA });
    // Only the camera file should exist so far.
    expect(existsSync(join(dir, 'cameras.json'))).toBe(true);
    expect(existsSync(join(dir, 'credentials.json'))).toBe(false);

    const dir2 = freshDir();
    new FileCredentialPersistence(dir2).save({ foredeck: credA });
    expect(existsSync(join(dir2, 'credentials.json'))).toBe(true);
    expect(existsSync(join(dir2, 'cameras.json'))).toBe(false);
  });

  it('each persistence loads back only its own data via fresh instances', () => {
    const dir = freshDir();
    new FileCameraPersistence(dir).save({ foredeck: camA, mast: camB });
    new FileCredentialPersistence(dir).save({ foredeck: credA });

    const camerasReloaded = new FileCameraPersistence(dir).load();
    const credsReloaded = new FileCredentialPersistence(dir).load();

    expect(camerasReloaded).toEqual({ foredeck: camA, mast: camB });
    expect(credsReloaded).toEqual({ foredeck: credA });
    // Cross-contamination check: neither map leaks into the other.
    expect(camerasReloaded).not.toHaveProperty('foredeck.username');
    expect(credsReloaded).not.toHaveProperty('mast');
  });

  it('both files are written owner-only (0o600) at rest', () => {
    const dir = freshDir();
    new FileCameraPersistence(dir).save({ foredeck: camA });
    new FileCredentialPersistence(dir).save({ foredeck: credA });
    expectOwnerOnly(join(dir, 'cameras.json'));
    expectOwnerOnly(join(dir, 'credentials.json'));
  });
});
