/** Result of identifying an uploaded blob by its magic bytes. */
export interface ISniffResult {
  contentType: string;
}

/**
 * Identifies an uploaded video by its container magic bytes (never by the client's filename or
 * Content-Type). Returns the safe Content-Type to serve it back with, or null if it isn't an
 * allowed video container — so an HTML/script payload renamed to .mp4 is rejected at ingest.
 */
/** Major brands we accept in an ISO-BMFF `ftyp` box (mp4/mov family). */
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'mp4v',
  'avc1',
  'm4v ',
  'M4V ',
  'M4VH',
  'dash',
  'hvc1',
  'hev1',
  '3gp4',
  '3gp5',
  '3g2a',
]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = '';
  for (let i = start; i < start + length && i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

/**
 * Identifies an image by its magic bytes, for the snapshot path (which stores JPEG/PNG frames rather
 * than video containers). Kept separate from {@link sniffVideoType} so the video-upload route's
 * container allow-list is not widened to accept images. Returns null for anything else.
 */
export function sniffImageType(bytes: Uint8Array): ISniffResult | null {
  // JPEG: SOI marker FF D8 followed by another FF (start of the first marker segment).
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg' };
  }
  // PNG: the 8-byte signature.
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: 'image/png' };
  }
  return null;
}

export function sniffVideoType(bytes: Uint8Array): ISniffResult | null {
  if (bytes.length < 12) {
    return null;
  }

  // ISO base media file format (mp4 / mov): a `ftyp` box at offset 4, brand at offset 8.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'qt  ') {
      return { contentType: 'video/quicktime' };
    }
    if (MP4_BRANDS.has(brand)) {
      return { contentType: 'video/mp4' };
    }
    return null;
  }

  // Matroska / WebM: EBML magic, then a DocType string in the header.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    const head = ascii(bytes, 0, Math.min(bytes.length, 64));
    if (head.includes('webm')) {
      return { contentType: 'video/webm' };
    }
    if (head.includes('matroska')) {
      return { contentType: 'video/x-matroska' };
    }
    return null;
  }

  return null;
}
