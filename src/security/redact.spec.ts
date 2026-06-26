import { describe, it, expect } from 'vitest';
import { redactUrl } from './redact';

describe('redactUrl', () => {
  it('replaces userinfo with a redaction marker', () => {
    expect(redactUrl('rtsp://admin:secret@cam.local:554/stream')).toBe(
      'rtsp://***@cam.local:554/stream',
    );
    expect(redactUrl('http://user:p%40ss@host/path')).toBe('http://***@host/path');
  });

  it('leaves URLs without credentials unchanged', () => {
    expect(redactUrl('rtsp://cam.local:554/stream')).toBe('rtsp://cam.local:554/stream');
  });

  it('leaves non-URL strings unchanged', () => {
    expect(redactUrl('just some text')).toBe('just some text');
  });

  it('redacts a username-only userinfo', () => {
    expect(redactUrl('rtsp://admin@cam/s')).toBe('rtsp://***@cam/s');
  });
});
