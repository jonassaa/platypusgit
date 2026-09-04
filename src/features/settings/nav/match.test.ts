// Search matching, and the Store gate that keeps an update check out of the
// index on a Microsoft Store install.
import { describe, expect, it } from "vitest";

import { buildIndex, matchRows, matchCountsByPage } from "./match";

const FULL = buildIndex({ updatable: true });

describe("matchRows", () => {
  it("matches a label", () => {
    const ids = matchRows("context lines", FULL).map((r) => r.row.id);
    expect(ids).toContain("diff.context");
  });

  it("requires every term (AND, not OR)", () => {
    expect(matchRows("dark theme", FULL).map((r) => r.row.id)).toContain("appearance.dark");
    expect(matchRows("dark banana", FULL)).toHaveLength(0);
  });

  it("matches on keywords the label does not contain", () => {
    expect(matchRows("gpg", FULL).map((r) => r.row.id)).toContain("commit.sign");
    expect(matchRows("pwsh", FULL).map((r) => r.row.id)).toContain("workspace.shell");
  });

  it("matches every row on a page whose title matches", () => {
    const hits = matchRows("diff", FULL).filter((r) => r.pageId === "git.diff");
    expect(hits).toHaveLength(5);
  });

  it("spans pages", () => {
    // "version" is on general.updates (updates.version's label "Current
    // version") AND on advanced.backup (diagnostics.environment's keyword
    // "version" in "version os arch git bug report") — two distinct pages,
    // verified against the real metas. "dark" (the brief's original query)
    // does not span: it only occurs on general.appearance, in
    // appearance.follow's keywords and appearance.dark's label/keywords.
    const pages = new Set(matchRows("version", FULL).map((r) => r.pageId));
    expect(pages.size).toBeGreaterThan(1);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(matchRows("  DARK   THEME ", FULL).map((r) => r.row.id)).toContain("appearance.dark");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(matchRows("zzzznope", FULL)).toHaveLength(0);
  });

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(matchRows("", FULL)).toHaveLength(0);
    expect(matchRows("   ", FULL)).toHaveLength(0);
  });

  it("counts hits per page", () => {
    const counts = matchCountsByPage(matchRows("diff", FULL));
    expect(counts.get("git.diff")).toBe(5);
  });
});

describe("the Store gate", () => {
  it("indexes the check and channel on an ordinary install", () => {
    const ids = FULL.map((r) => r.row.id);
    expect(ids).toContain("updates.check");
    expect(ids).toContain("updates.channel");
  });

  it("omits them entirely when updates are managed externally", () => {
    // Store policy 10.2.5: NAMING an update check is the violation. A search
    // for "update" must not offer one on a Store install — that is what failed
    // v0.4.0 certification.
    const gated = buildIndex({ updatable: false });
    const ids = gated.map((r) => r.row.id);
    expect(ids).not.toContain("updates.check");
    expect(ids).not.toContain("updates.channel");
    expect(ids).toContain("updates.version");
    expect(matchRows("check for updates", gated)).toHaveLength(0);
    expect(matchRows("release channel", gated)).toHaveLength(0);
  });
});
