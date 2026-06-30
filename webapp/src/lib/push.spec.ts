import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 VAPID key to bytes', () => {
    // "hello" → standard base64 "aGVsbG8="; URL-safe + unpadded is "aGVsbG8".
    const bytes = urlBase64ToUint8Array('aGVsbG8');
    expect(Array.from(bytes)).toEqual([...'hello'].map((c) => c.charCodeAt(0)));
  });

  it('handles URL-safe chars (- and _) and missing padding', () => {
    // standard base64 "++//" uses + and /, URL-safe form is "--__".
    const std = urlBase64ToUint8Array('--__');
    expect(std).toBeInstanceOf(Uint8Array);
    expect(std.length).toBe(3); // 4 base64 chars → 3 bytes
  });
});
