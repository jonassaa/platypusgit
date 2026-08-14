// Real grammars, real engine, no mocks. Every other syntax suite fakes the
// highlighter, so this is the only thing proving the sentinel theme actually
// round-trips: scope table → generated theme → codeToTokens → syn-* class.
// Deliberately tiny so registering one grammar stays cheap.
import { describe, expect, it } from "vitest";
import { clearSyntaxCache, tokenizeFile } from "./tokenize";

describe("tokenizeFile against real Shiki", () => {
  it("classifies a keyword, a comment and a string in TypeScript", async () => {
    clearSyntaxCache();
    const lines = await tokenizeFile("a.ts", '// hi\nconst s = "x";');
    expect(lines).not.toBeNull();
    expect(lines).toHaveLength(2);

    const classes = (i: number) => lines![i].map((t) => t.cls);
    expect(classes(0)).toContain("syn-comment");
    expect(classes(1)).toContain("syn-keyword");
    expect(classes(1)).toContain("syn-string");
  });

  it("keeps ranges line-relative on lines after the first", async () => {
    clearSyntaxCache();
    const lines = await tokenizeFile("a.ts", "const a = 1;\nconst b = 2;");
    expect(lines).not.toBeNull();
    // Absolute offsets would put line 2's first token at 13, not 0 — the bug
    // this rebase exists to prevent.
    expect(lines![1][0].start).toBe(0);
    for (const t of lines![1]) {
      expect(t.end).toBeLessThanOrEqual("const b = 2;".length);
    }
  });

  it("returns null for a language with no grammar", async () => {
    clearSyntaxCache();
    expect(await tokenizeFile("LICENSE", "whatever")).toBeNull();
  });
});
