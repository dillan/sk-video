import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialStore, type ICredentialPersistence } from './credential-store';
import type { ICameraCredentials } from '../gateway/go2rtc-source';

class FakePersistence implements ICredentialPersistence {
  saves = 0;
  constructor(public data: Record<string, ICameraCredentials> = {}) {}
  load() {
    return this.data;
  }
  save(c: Record<string, ICameraCredentials>) {
    this.saves++;
    this.data = c;
  }
}

describe('CredentialStore', () => {
  let persistence: FakePersistence;
  let store: CredentialStore;

  beforeEach(() => {
    persistence = new FakePersistence();
    store = new CredentialStore(persistence);
  });

  it('loads existing credentials', () => {
    const seeded = new FakePersistence({ a: { username: 'u', password: 'p' } });
    expect(new CredentialStore(seeded).get('a')).toEqual({ username: 'u', password: 'p' });
  });

  it('stores, persists and reads back credentials', () => {
    store.set('foredeck', { username: 'admin', password: 'secret' });
    expect(store.get('foredeck')).toEqual({ username: 'admin', password: 'secret' });
    expect(persistence.saves).toBe(1);
  });

  it('exposes all credentials for building the gateway config', () => {
    store.set('a', { username: 'u', password: 'p' });
    store.set('b', { username: 'x' });
    expect(store.all()).toEqual({ a: { username: 'u', password: 'p' }, b: { username: 'x' } });
  });

  it('rejects an invalid camera id', () => {
    expect(() => store.set('../evil', { username: 'u' })).toThrow();
    expect(persistence.saves).toBe(0);
  });

  it('rejects a non-string username or password', () => {
    expect(() => store.set('a', { username: 5 })).toThrow();
    expect(() => store.set('a', { password: {} })).toThrow();
    expect(() => store.set('a', 'not-an-object')).toThrow();
  });

  it('deletes credentials and persists the change', () => {
    store.set('foredeck', { username: 'u' });
    expect(store.delete('foredeck')).toBe(true);
    expect(store.get('foredeck')).toBeNull();
    expect(store.delete('foredeck')).toBe(false);
  });

  it('rejects an over-long username or password and does not persist it', () => {
    const tooLong = 'x'.repeat(1025);
    expect(() => store.set('a', { username: tooLong })).toThrow();
    expect(() => store.set('a', { password: tooLong })).toThrow();
    expect(persistence.saves).toBe(0);
    expect(store.get('a')).toBeNull();
  });

  it('accepts a username and password at the length limit', () => {
    const max = 'x'.repeat(1024);
    store.set('a', { username: max, password: max });
    expect(store.get('a')).toEqual({ username: max, password: max });
  });
});
