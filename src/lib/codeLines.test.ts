import { describe, expect, it } from "vitest";
import { splitCodeLines } from "./codeLines";

describe("splitCodeLines", () => {
  it("returns no lines for empty text, so callers can show an empty state", () => {
    expect(splitCodeLines("")).toEqual([]);
  });

  it("does not count a trailing newline as a line", () => {
    expect(splitCodeLines("a\n")).toEqual(["a"]);
    expect(splitCodeLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("keeps a file with no trailing newline intact", () => {
    expect(splitCodeLines("a\nb")).toEqual(["a", "b"]);
  });

  it("preserves interior blank lines", () => {
    expect(splitCodeLines("a\n\nb\n")).toEqual(["a", "", "b"]);
  });

  it("drops only ONE trailing newline, so a blank last line survives", () => {
    expect(splitCodeLines("a\n\n")).toEqual(["a", ""]);
  });
});
