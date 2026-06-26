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

  // Regression: every log line is prefixed ("go2rtc: ...") before reaching redactUrl, so the
  // credential URL is never at the start of the string. An anchored regex would silently miss it.
  it('redacts a credential URL embedded mid-string (prefixed log line)', () => {
    expect(
      redactUrl('go2rtc: WRN [rtsp] dial rtsp://admin:secret@192.168.1.10:554/h264 failed'),
    ).toBe('go2rtc: WRN [rtsp] dial rtsp://***@192.168.1.10:554/h264 failed');
  });

  it('redacts every credential URL when more than one appears', () => {
    expect(redactUrl('tried rtsp://u1:p1@h1/s then rtsp://u2:p2@h2/s')).toBe(
      'tried rtsp://***@h1/s then rtsp://***@h2/s',
    );
  });

  it('leaves an @ in a path (no userinfo) unchanged', () => {
    expect(redactUrl('fetch http://host/path@v2 ok')).toBe('fetch http://host/path@v2 ok');
  });
});
