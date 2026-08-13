import { describe, expect, it } from "vitest";
import { MAX_LINE_CHARS, wordDiff, type WordSpan } from "./wordDiff";

/** The changed substrings of one side, for compact assertions. */
const changed = (text: string, spans: WordSpan[]) =>
  spans.filter((s) => s.changed).map((s) => text.slice(s.start, s.end));

/** Spans must tile the whole input, in order, with no gaps or overlaps. */
function assertTiles(text: string, spans: WordSpan[]) {
  let at = 0;
  for (const s of spans) {
    expect(s.start).toBe(at);
    expect(s.end).toBeGreaterThan(s.start);
    at = s.end;
  }
  expect(at).toBe(text.length);
}

describe("wordDiff", () => {
  it("returns no changed spans for identical text", () => {
    const t = "const a = 1;";
    const r = wordDiff(t, t)!;
    expect(changed(t, r.old)).toEqual([]);
    expect(changed(t, r.new)).toEqual([]);
  });

  it("isolates a single changed word", () => {
    const a = "const a = 1;";
    const b = "const a = 2;";
    const r = wordDiff(a, b)!;
    expect(changed(a, r.old)).toEqual(["1"]);
    expect(changed(b, r.new)).toEqual(["2"]);
  });

  it("handles an insertion at the end", () => {
    const a = "call(x)";
    const b = "call(x, y)";
    const r = wordDiff(a, b)!;
    expect(changed(a, r.old)).toEqual([]);
    expect(changed(b, r.new).join("")).toContain("y");
  });

  it("handles an insertion at the start", () => {
    const a = "value";
    const b = "new value";
    const r = wordDiff(a, b)!;
    expect(changed(b, r.new).join("")).toContain("new");
  });

  it("tiles both sides completely", () => {
    const a = "let total = price * qty;";
    const b = "let total = price * quantity;";
    const r = wordDiff(a, b)!;
    assertTiles(a, r.old);
    assertTiles(b, r.new);
  });

  it("treats a whitespace-only difference as changed whitespace, not words", () => {
    const a = "a  b";
    const b = "a b";
    const r = wordDiff(a, b)!;
    expect(changed(a, r.old).join("").trim()).toBe("");
    expect(changed(b, r.new).join("").trim()).toBe("");
  });

  it("returns null for a pair below the similarity threshold", () => {
    expect(
      wordDiff("alpha beta gamma", "totally different words here"),
    ).toBeNull();
  });

  it("returns null when a line is too long to diff", () => {
    const long = "x".repeat(MAX_LINE_CHARS + 1);
    expect(wordDiff(long, long + "y")).toBeNull();
  });

  it("maps multi-byte characters to correct ranges", () => {
    const a = "greet('héllo')";
    const b = "greet('wörld')";
    const r = wordDiff(a, b)!;
    expect(changed(a, r.old)).toEqual(["héllo"]);
    expect(changed(b, r.new)).toEqual(["wörld"]);
  });

  it("is symmetric in span coverage for a swap", () => {
    const r1 = wordDiff("a = b", "a = c")!;
    const r2 = wordDiff("a = c", "a = b")!;
    expect(changed("a = b", r1.old)).toEqual(changed("a = b", r2.new));
  });

  it("handles two empty strings without throwing", () => {
    const r = wordDiff("", "")!;
    expect(r.old).toEqual([]);
    expect(r.new).toEqual([]);
  });

  it("marks a wholly-inserted line when the other side is empty", () => {
    // Nothing common, but the shorter side has no word tokens at all, so the
    // similarity gate must not reject it.
    const r = wordDiff("", "added line")!;
    expect(changed("added line", r.new).join("")).toContain("added");
  });
});
