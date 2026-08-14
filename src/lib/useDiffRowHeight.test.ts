import { afterEach, describe, expect, it } from "vitest";
import { DIFF_ROW_H_FALLBACK, readDiffRowHeight } from "./useDiffRowHeight";

afterEach(() => {
  document.documentElement.style.removeProperty("--diff-row-h");
});

describe("readDiffRowHeight", () => {
  it("parses a px value from the custom property", () => {
    document.documentElement.style.setProperty("--diff-row-h", "18.6px");
    expect(readDiffRowHeight()).toBeCloseTo(18.6);
  });

  it("falls back when the value is not resolved to px", () => {
    // jsdom does not evaluate calc(), and a NaN here would collapse every
    // windowed row to zero height.
    document.documentElement.style.setProperty("--diff-row-h", "calc(12px * 1.55)");
    expect(readDiffRowHeight()).toBe(DIFF_ROW_H_FALLBACK);
  });

  it("falls back when the property is missing", () => {
    expect(readDiffRowHeight()).toBe(DIFF_ROW_H_FALLBACK);
  });

  it("falls back on a nonsense or non-positive value", () => {
    document.documentElement.style.setProperty("--diff-row-h", "0px");
    expect(readDiffRowHeight()).toBe(DIFF_ROW_H_FALLBACK);
    document.documentElement.style.setProperty("--diff-row-h", "banana");
    expect(readDiffRowHeight()).toBe(DIFF_ROW_H_FALLBACK);
  });
});
