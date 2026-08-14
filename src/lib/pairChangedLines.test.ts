import { describe, expect, it } from "vitest";
import { pairChangedLines } from "./pairChangedLines";

describe("pairChangedLines", () => {
  it("pairs the i-th removal with the i-th addition", () => {
    const out = pairChangedLines(["let a = 1"], ["let a = 2"]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBeNull();
    expect(out[0]!.old.some((s) => s.changed)).toBe(true);
    expect(out[0]!.new.some((s) => s.changed)).toBe(true);
  });

  it("pairs only min(rem, add) lines", () => {
    expect(pairChangedLines(["a", "b", "c"], ["a2"])).toHaveLength(1);
    expect(pairChangedLines(["a"], ["a2", "b2", "c2"])).toHaveLength(1);
  });

  it("returns an empty array when either side is empty", () => {
    expect(pairChangedLines([], ["a"])).toEqual([]);
    expect(pairChangedLines(["a"], [])).toEqual([]);
  });

  it("yields null for a pair too dissimilar to be one edited line", () => {
    // wordDiff declines below MIN_SIMILARITY: highlighting unrelated rewrites at
    // random reads as noise and is worse than no word diff at all.
    const out = pairChangedLines(
      ["import { readFile } from 'node:fs/promises'"],
      ["export const TOTALLY_UNRELATED = 42"],
    );
    expect(out[0]).toBeNull();
  });

  it("keeps each pair independent, so one declined pair does not shift the rest", () => {
    const out = pairChangedLines(
      ["let a = 1", "zzzzzzzzzzzzzzzz"],
      ["let a = 2", "const q = [1, 2]"],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
  });
});
