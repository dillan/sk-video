/** The outcome of parsing a Range request header against a known content size. */
export type IRangeResult =
  | { type: "full" }
  | { type: "range"; start: number; end: number }
  | { type: "unsatisfiable" };

/**
 * Parses a single HTTP byte range against a content size. Unrecognized or multi-range requests fall
 * back to a full response (we don't serve multipart/byteranges); a syntactically valid range that
 * can't be satisfied returns 'unsatisfiable' (the caller answers 416). Bounds are clamped to the
 * content size so a hostile range can't read past the end of the file.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): IRangeResult {
  if (!header) {
    return { type: "full" };
  }
  const match = /^bytes=(.+)$/.exec(header.trim());
  if (!match) {
    return { type: "full" }; // unrecognized unit — serve the whole thing
  }
  const spec = match[1];
  if (spec.includes(",")) {
    return { type: "full" }; // multi-range: we don't emit multipart/byteranges
  }

  const dash = spec.indexOf("-");
  if (dash === -1) {
    return { type: "full" };
  }
  const startText = spec.slice(0, dash).trim();
  const endText = spec.slice(dash + 1).trim();

  let start: number;
  let end: number;

  if (startText === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0 || size === 0) {
      return { type: "unsatisfiable" };
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    if (!Number.isInteger(start) || start < 0) {
      return { type: "full" };
    }
    end = endText === "" ? size - 1 : Number(endText);
    if (!Number.isInteger(end) || end < start) {
      return { type: "unsatisfiable" };
    }
    end = Math.min(end, size - 1);
  }

  if (size === 0 || start >= size) {
    return { type: "unsatisfiable" };
  }
  return { type: "range", start, end };
}
