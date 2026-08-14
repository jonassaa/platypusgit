import { describe, expect, it } from "vitest";
import { buildLineSpans } from "./lineSpans";
import type { SyntaxToken } from "./syntax";
import type { WordSpan } from "./wordDiff";

const syn = (start: number, end: number, cls: string): SyntaxToken => ({ start, end, cls });
const word = (start: number, end: number, changed: boolean): WordSpan => ({
  start,
  end,
  changed,
});

/** Every span concatenated must reproduce the line exactly — the tiling contract. */
function tiles(text: string, spans: { start: number; end: number }[]) {
  return spans.map((s) => text.slice(s.start, s.end)).join("");
}

describe("buildLineSpans", () => {
  it("returns one unstyled span when there is nothing to apply", () => {
    expect(buildLineSpans("abc", null, undefined)).toEqual([
      { start: 0, end: 3, cls: undefined, changed: false },
    ]);
  });

  it("returns an empty array for an empty line", () => {
    expect(buildLineSpans("", null, undefined)).toEqual([]);
  });

  it("carries syntax classes when there is no word diff", () => {
    const out = buildLineSpans("let x", [syn(0, 3, "syn-keyword")], undefined);
    expect(out).toEqual([
      { start: 0, end: 3, cls: "syn-keyword", changed: false },
      { start: 3, end: 5, cls: undefined, changed: false },
    ]);
    expect(tiles("let x", out)).toBe("let x");
  });

  it("carries changed flags when there is no syntax", () => {
    const out = buildLineSpans("ab", null, [word(0, 1, true), word(1, 2, false)]);
    expect(out).toEqual([
      { start: 0, end: 1, cls: undefined, changed: true },
      { start: 1, end: 2, cls: undefined, changed: false },
    ]);
  });

  it("splits at the union of both boundary sets", () => {
    // syntax 0-5 "syn-string"; word change 2-4. Expect 0-2, 2-4, 4-5.
    const out = buildLineSpans("abcde", [syn(0, 5, "syn-string")], [
      word(0, 2, false),
      word(2, 4, true),
      word(4, 5, false),
    ]);
    expect(out).toEqual([
      { start: 0, end: 2, cls: "syn-string", changed: false },
      { start: 2, end: 4, cls: "syn-string", changed: true },
      { start: 4, end: 5, cls: "syn-string", changed: false },
    ]);
    expect(tiles("abcde", out)).toBe("abcde");
  });

  it("tiles gaps between syntax tokens", () => {
    const out = buildLineSpans("a b", [syn(0, 1, "syn-var"), syn(2, 3, "syn-var")], undefined);
    expect(out.map((s) => [s.start, s.end, s.cls])).toEqual([
      [0, 1, "syn-var"],
      [1, 2, undefined],
      [2, 3, "syn-var"],
    ]);
    expect(tiles("a b", out)).toBe("a b");
  });

  it("clamps ranges that overrun the line and drops empty ones", () => {
    const out = buildLineSpans("ab", [syn(0, 99, "syn-type"), syn(5, 5, "syn-var")], undefined);
    expect(out).toEqual([{ start: 0, end: 2, cls: "syn-type", changed: false }]);
  });

  it("never emits a zero-width span", () => {
    const out = buildLineSpans("abc", [syn(1, 1, "syn-var")], [word(0, 0, true)]);
    for (const s of out) expect(s.end).toBeGreaterThan(s.start);
    expect(tiles("abc", out)).toBe("abc");
  });
});
