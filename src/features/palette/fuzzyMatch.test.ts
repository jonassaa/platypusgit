import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./fuzzyMatch";

describe("fuzzyMatch", () => {
  it("matches an exact substring", () => {
    const r = fuzzyMatch("feat", "feature/palette");
    expect(r.matched).toBe(true);
    expect(r.indices).toEqual([0, 1, 2, 3]);
  });

  it("matches a non-contiguous subsequence in order", () => {
    const r = fuzzyMatch("ftp", "feature/palette");
    expect(r.matched).toBe(true);
    // f(0) ... t(3) ... p(8)
    expect(r.indices[0]).toBe(0);
    expect(r.indices.length).toBe(3);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("MAIN", "origin/main").matched).toBe(true);
    expect(fuzzyMatch("main", "ORIGIN/MAIN").matched).toBe(true);
  });

  it("fails when chars are out of order", () => {
    expect(fuzzyMatch("tf", "feat").matched).toBe(false);
  });

  it("fails when a char is missing", () => {
    expect(fuzzyMatch("xyz", "feature").matched).toBe(false);
  });

  it("treats empty query as a zero-score match", () => {
    const r = fuzzyMatch("", "anything");
    expect(r.matched).toBe(true);
    expect(r.score).toBe(0);
    expect(r.indices).toEqual([]);
  });

  it("scores a consecutive run higher than scattered matches", () => {
    const consecutive = fuzzyMatch("abc", "abcxyz").score;
    const scattered = fuzzyMatch("abc", "axbxc").score;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it("scores a word-boundary match higher than a mid-word match", () => {
    // 'p' at the start of a path segment vs 'p' inside a word
    const boundary = fuzzyMatch("p", "src/palette").score;
    const midword = fuzzyMatch("p", "wrapper").score;
    expect(boundary).toBeGreaterThan(midword);
  });

  it("scores an earlier match higher than a later one", () => {
    const early = fuzzyMatch("x", "xaaaa").score;
    const late = fuzzyMatch("x", "aaaax").score;
    expect(early).toBeGreaterThan(late);
  });

  it("returns zero score and no indices on a miss", () => {
    const r = fuzzyMatch("zzz", "abc");
    expect(r.matched).toBe(false);
    expect(r.score).toBe(0);
    expect(r.indices).toEqual([]);
  });

  it("recognizes camelCase boundaries", () => {
    const r = fuzzyMatch("cp", "CommandPalette");
    expect(r.matched).toBe(true);
    // C(0), P(7)
    expect(r.indices).toEqual([0, 7]);
  });
});
