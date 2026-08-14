import { describe, expect, it } from "vitest";
import { SYN_TOKENS, SENTINEL_THEME, classForColor, sentinelFor } from "./scopes";

describe("scopes table", () => {
  it("gives every token a unique sentinel", () => {
    const seen = new Set(SYN_TOKENS.map((t) => sentinelFor(t)));
    expect(seen.size).toBe(SYN_TOKENS.length);
  });

  it("maps each sentinel back to its class", () => {
    for (const t of SYN_TOKENS) {
      expect(classForColor(sentinelFor(t))).toBe(`syn-${t}`);
    }
  });

  it("matches sentinels case-insensitively, because Shiki upper-cases colours", () => {
    const s = sentinelFor("keyword");
    expect(classForColor(s.toUpperCase())).toBe("syn-keyword");
    expect(classForColor(s.toLowerCase())).toBe("syn-keyword");
  });

  it("returns undefined for a colour that is not a sentinel", () => {
    expect(classForColor("#ff00ff")).toBeUndefined();
    expect(classForColor("")).toBeUndefined();
  });

  it("emits one theme setting per token plus a default foreground", () => {
    // First entry is the scope-less default; the rest carry scopes.
    expect(SENTINEL_THEME.settings[0].scope).toBeUndefined();
    const scoped = SENTINEL_THEME.settings.slice(1);
    expect(scoped).toHaveLength(SYN_TOKENS.length);
    for (const s of scoped) {
      expect(Array.isArray(s.scope)).toBe(true);
      expect((s.scope as string[]).length).toBeGreaterThan(0);
    }
  });

  it("covers the scopes that matter for the repo's own languages", () => {
    const all = SENTINEL_THEME.settings.flatMap((s) => (s.scope as string[]) ?? []);
    for (const scope of [
      "keyword",
      "comment",
      "string",
      "constant.numeric",
      "entity.name.function",
      "entity.name.type",
      "variable",
      "entity.name.tag",
    ]) {
      expect(all).toContain(scope);
    }
  });
});
