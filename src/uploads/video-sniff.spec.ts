import { describe, it, expect } from 'vitest';
import { sniffVideoType } from './video-sniff';

/** Builds bytes from a mix of ascii strings and raw byte arrays. */
function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      for (const ch of p) out.push(ch.charCodeAt(0));
    } else {
      out.push(...p);
    }
  }
  return Uint8Array.from(out);
}

const SIZE_BOX = [0, 0, 0, 0x20];

describe('sniffVideoType', () => {
  it('accepts an ISO-BMFF mp4 (ftyp + isom brand) as video/mp4', () => {
    expect(sniffVideoType(bytes(SIZE_BOX, 'ftypisom', [0, 0, 2, 0], 'isomiso2avc1mp41'))).toEqual({
      contentType: 'video/mp4',
    });
  });

  it('accepts a QuickTime movie (ftyp + qt brand) as video/quicktime', () => {
    expect(sniffVideoType(bytes(SIZE_BOX, 'ftypqt  ', [0, 0, 2, 0]))).toEqual({
      contentType: 'video/quicktime',
    });
  });

  it('accepts a WebM file (EBML + webm doctype) as video/webm', () => {
    expect(sniffVideoType(bytes([0x1a, 0x45, 0xdf, 0xa3], 'some ebml header webm more'))).toEqual({
      contentType: 'video/webm',
    });
  });

  it('accepts a Matroska file as video/x-matroska', () => {
    expect(sniffVideoType(bytes([0x1a, 0x45, 0xdf, 0xa3], 'header matroska doctype'))).toEqual({
      contentType: 'video/x-matroska',
    });
  });

  it('rejects HTML masquerading as a video', () => {
    expect(sniffVideoType(bytes('<!DOCTYPE html><script>alert(1)</script>'))).toBeNull();
  });

  it('rejects an ftyp box with an unknown brand', () => {
    expect(sniffVideoType(bytes(SIZE_BOX, 'ftypXXXX', [0, 0, 0, 0]))).toBeNull();
  });

  it('rejects a too-short buffer', () => {
    expect(sniffVideoType(bytes([0x1a, 0x45]))).toBeNull();
  });
});
