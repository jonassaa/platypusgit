import { describe, expect, it } from "vitest";
import {
  buildLogFilter,
  isFilterEmpty,
  normalizeFilter,
  parseQueryText,
} from "./logFilter";

describe("parseQueryText", () => {
  it("treats plain text as a message substring", () => {
    expect(parseQueryText("fix parser bug")).toEqual({ message: "fix parser bug" });
  });

  it("extracts author: qualifier", () => {
    expect(parseQueryText("author:alice")).toEqual({ author: "alice" });
  });

  it("extracts path: qualifier", () => {
    expect(parseQueryText("path:src/foo.ts")).toEqual({ path: "src/foo.ts" });
  });

  it("combines qualifier with free-text message", () => {
    expect(parseQueryText("author:bob refactor")).toEqual({
      author: "bob",
      message: "refactor",
    });
  });

  it("treats a lone hex token as a sha prefix", () => {
    expect(parseQueryText("abc123")).toEqual({ shaPrefix: "abc123" });
  });

  it("does not treat a hex token as sha when other text is present", () => {
    expect(parseQueryText("abc123 cleanup")).toEqual({ message: "abc123 cleanup" });
  });

  it("honors an explicit sha: qualifier even with other text", () => {
    expect(parseQueryText("sha:deadbeef cleanup")).toEqual({
      shaPrefix: "deadbeef",
      message: "cleanup",
    });
  });

  it("supports aliases (by, file, msg)", () => {
    expect(parseQueryText("by:carol file:README.md msg:docs")).toEqual({
      author: "carol",
      path: "README.md",
      message: "docs",
    });
  });

  it("parses since/until dates to unix seconds", () => {
    const out = parseQueryText("since:2024-01-01 until:2024-12-31");
    // local-time midnight / end-of-day; just assert ordering + presence.
    expect(typeof out.since).toBe("number");
    expect(typeof out.until).toBe("number");
    expect(out.until! > out.since!).toBe(true);
  });

  it("ignores malformed dates", () => {
    expect(parseQueryText("since:nope")).toEqual({});
  });

  it("returns empty object for blank input", () => {
    expect(parseQueryText("   ")).toEqual({});
  });
});

describe("buildLogFilter", () => {
  it("merges free text with dedicated fields", () => {
    const f = buildLogFilter({
      text: "parser",
      author: "alice",
      path: "src/lib.rs",
    });
    expect(f).toEqual({
      message: "parser",
      author: "alice",
      path: "src/lib.rs",
    });
  });

  it("dedicated author overrides a text qualifier", () => {
    const f = buildLogFilter({ text: "author:fromtext", author: "fromfield" });
    expect(f.author).toBe("fromfield");
  });

  it("applies date inputs as since/until bounds", () => {
    const f = buildLogFilter({ sinceDate: "2024-06-01", untilDate: "2024-06-30" });
    expect(typeof f.since).toBe("number");
    expect(typeof f.until).toBe("number");
    expect(f.until! > f.since!).toBe(true);
  });

  it("produces an empty filter from all-blank inputs", () => {
    expect(buildLogFilter({ text: "  ", author: "", path: "" })).toEqual({});
  });
});

describe("normalizeFilter / isFilterEmpty", () => {
  it("drops blank string fields", () => {
    expect(normalizeFilter({ message: "  ", author: "x", path: "" })).toEqual({
      author: "x",
    });
  });

  it("isFilterEmpty true for blank-only filter", () => {
    expect(isFilterEmpty({ message: "", author: null, path: undefined })).toBe(true);
  });

  it("isFilterEmpty false when any field set", () => {
    expect(isFilterEmpty({ since: 1000 })).toBe(false);
  });
});
