import { describe, it, expect } from "vitest";
import { parseRange } from "./range";

describe("parseRange", () => {
  it("returns full when there is no Range header", () => {
    expect(parseRange(undefined, 1000)).toEqual({ type: "full" });
  });

  it("parses a closed range", () => {
    expect(parseRange("bytes=0-499", 1000)).toEqual({
      type: "range",
      start: 0,
      end: 499,
    });
  });

  it("parses an open-ended range to the last byte", () => {
    expect(parseRange("bytes=500-", 1000)).toEqual({
      type: "range",
      start: 500,
      end: 999,
    });
  });

  it("parses a suffix range (last N bytes)", () => {
    expect(parseRange("bytes=-200", 1000)).toEqual({
      type: "range",
      start: 800,
      end: 999,
    });
  });

  it("clamps an end that runs past the content size", () => {
    expect(parseRange("bytes=900-5000", 1000)).toEqual({
      type: "range",
      start: 900,
      end: 999,
    });
  });

  it("clamps a suffix larger than the content to the whole file", () => {
    expect(parseRange("bytes=-5000", 1000)).toEqual({
      type: "range",
      start: 0,
      end: 999,
    });
  });

  it("reports unsatisfiable when the start is at or past the end", () => {
    expect(parseRange("bytes=1000-1001", 1000)).toEqual({
      type: "unsatisfiable",
    });
  });

  it("reports unsatisfiable for a start greater than end", () => {
    expect(parseRange("bytes=600-500", 1000)).toEqual({
      type: "unsatisfiable",
    });
  });

  it("treats a multi-range request as a full response (no multipart)", () => {
    expect(parseRange("bytes=0-99,200-299", 1000)).toEqual({ type: "full" });
  });

  it("ignores an unrecognized unit", () => {
    expect(parseRange("items=0-10", 1000)).toEqual({ type: "full" });
  });

  it("reports unsatisfiable for any range against an empty file", () => {
    expect(parseRange("bytes=0-0", 0)).toEqual({ type: "unsatisfiable" });
  });
});
