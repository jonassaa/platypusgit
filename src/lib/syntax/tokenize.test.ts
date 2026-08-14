import { beforeEach, describe, expect, it, vi } from "vitest";

// Real grammars are slow and asynchronous; this suite is about ranges, guards
// and caching, so the highlighter is faked. The fake mimics the two Shiki
// behaviours that bite: document-absolute offsets and upper-cased colours.
const codeToTokens = vi.fn();
vi.mock("./shiki", () => ({
  SENTINEL_THEME_NAME: "pg-sentinel",
  getHighlighter: async () => ({ codeToTokens }),
  ensureLanguage: async () => true,
}));

import { sentinelFor } from "./scopes";
import {
  MAX_HIGHLIGHT_BYTES,
  MAX_HIGHLIGHT_LINES,
  clearSyntaxCache,
  toLineRelative,
  tokenizeFile,
} from "./tokenize";

const KW = sentinelFor("keyword").toUpperCase();

beforeEach(() => {
  clearSyntaxCache();
  codeToTokens.mockReset();
});

describe("toLineRelative", () => {
  it("rebases document-absolute offsets onto their own line", () => {
    // "ab\ncd" — the second line's token sits at absolute offset 3.
    const out = toLineRelative([
      [{ content: "ab", offset: 0, color: KW }],
      [{ content: "cd", offset: 3, color: KW }],
    ]);
    expect(out[0][0]).toEqual({ start: 0, end: 2, cls: "syn-keyword" });
    expect(out[1][0]).toEqual({ start: 0, end: 2, cls: "syn-keyword" });
  });

  it("drops tokens whose colour is not a sentinel", () => {
    const out = toLineRelative([
      [
        { content: "a", offset: 0, color: KW },
        { content: "b", offset: 1, color: "#0000FF" },
      ],
    ]);
    expect(out[0]).toHaveLength(1);
    expect(out[0][0].cls).toBe("syn-keyword");
  });

  it("keeps an empty line as an empty token array", () => {
    expect(toLineRelative([[], [{ content: "x", offset: 1, color: KW }]])).toEqual([
      [],
      [{ start: 0, end: 1, cls: "syn-keyword" }],
    ]);
  });
});

describe("tokenizeFile", () => {
  it("returns per-line tokens for a known language", async () => {
    codeToTokens.mockReturnValue({
      tokens: [[{ content: "let", offset: 0, color: KW }]],
    });
    const out = await tokenizeFile("a.ts", "let");
    expect(out).toEqual([[{ start: 0, end: 3, cls: "syn-keyword" }]]);
  });

  it("returns null for an unknown language without calling Shiki", async () => {
    expect(await tokenizeFile("LICENSE", "x")).toBeNull();
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  it("returns null past the byte guard", async () => {
    expect(await tokenizeFile("a.ts", "x".repeat(MAX_HIGHLIGHT_BYTES + 1))).toBeNull();
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  it("returns null past the line guard", async () => {
    expect(await tokenizeFile("a.ts", "\n".repeat(MAX_HIGHLIGHT_LINES + 1))).toBeNull();
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  it("returns null when Shiki throws, rather than propagating", async () => {
    codeToTokens.mockImplementation(() => {
      throw new Error("Language `x` not found");
    });
    expect(await tokenizeFile("a.ts", "let")).toBeNull();
  });

  it("caches by path and content", async () => {
    codeToTokens.mockReturnValue({ tokens: [[{ content: "let", offset: 0, color: KW }]] });
    await tokenizeFile("a.ts", "let");
    await tokenizeFile("a.ts", "let");
    expect(codeToTokens).toHaveBeenCalledTimes(1);
  });

  it("re-tokenizes when the content changes", async () => {
    codeToTokens.mockReturnValue({ tokens: [[{ content: "let", offset: 0, color: KW }]] });
    await tokenizeFile("a.ts", "let");
    await tokenizeFile("a.ts", "let x");
    expect(codeToTokens).toHaveBeenCalledTimes(2);
  });
});
