// Search matching, and the Store gate that keeps an update check out of the
// index on a Microsoft Store install.
import { describe, expect, it } from "vitest";

import { buildIndex, matchRows, matchCountsByPage } from "./match";
import type { SettingRowGate } from "./types";

/**
 * Every gate satisfied, then whichever ones a case wants closed.
 *
 * `buildIndex` takes a `Record` over the whole gate union, so this helper is
 * also where a NEW gate member stops the file compiling until someone decides
 * what the baseline answer for it is. `themeFixed` and `themeFollowsSystem`
 * are both true here — impossible at runtime (they are complements), but this
 * is "the index with nothing filtered out", which is what the matching cases
 * below want to search against.
 */
function gates(
  overrides: Partial<Record<SettingRowGate, boolean>> = {},
): Record<SettingRowGate, boolean> {
  return { updatable: true, themeFixed: true, themeFollowsSystem: true, ...overrides };
}

const FULL = buildIndex(gates());

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
    const gated = buildIndex(gates({ updatable: false }));
    const ids = gated.map((r) => r.row.id);
    expect(ids).not.toContain("updates.check");
    expect(ids).not.toContain("updates.channel");
    expect(ids).toContain("updates.version");
    expect(matchRows("check for updates", gated)).toHaveLength(0);
    expect(matchRows("release channel", gated)).toHaveLength(0);
  });
});

describe("the theme-mode gates", () => {
  // Appearance's light/dark pair and its single theme picker are mutually
  // exclusive in the DOM (`following ? … : …`). Indexing all three at once
  // made a search report a hit and render an empty card — the card's header
  // appears because one DECLARED row matched, but that row is not in the tree
  // in this mode. These two cases pin each mode to what it can actually show.
  //
  // Note the resolved-index test in `screens/settings.search.test.tsx`: these
  // pass the booleans in directly, so only that one can catch
  // `useSettingsIndex` reading `themePreference.mode` the wrong way round.
  it("indexes only the single theme picker while the theme is fixed", () => {
    const ids = buildIndex(gates({ themeFollowsSystem: false })).map((r) => r.row.id);
    expect(ids).toContain("appearance.theme");
    expect(ids).not.toContain("appearance.light");
    expect(ids).not.toContain("appearance.dark");
    // The mode toggle itself is never gated — it is how you reach the others.
    expect(ids).toContain("appearance.follow");
  });

  it("indexes only the light/dark pair while following the OS", () => {
    const ids = buildIndex(gates({ themeFixed: false })).map((r) => r.row.id);
    expect(ids).toContain("appearance.light");
    expect(ids).toContain("appearance.dark");
    expect(ids).not.toContain("appearance.theme");
    expect(ids).toContain("appearance.follow");
  });

  it("counts only the rows a mode can render", () => {
    // The reported bug verbatim: on a fresh install (mode "fixed") a search
    // for "light theme" claimed one result and rendered none.
    const fixed = buildIndex(gates({ themeFollowsSystem: false }));
    expect(matchRows("light theme", fixed)).toHaveLength(0);
    // "theme" used to report 3 Appearance hits and render 1.
    const appearanceHits = matchRows("theme", fixed).filter(
      (r) => r.pageId === "general.appearance",
    );
    expect(appearanceHits.map((r) => r.row.id)).toEqual(["appearance.theme"]);
  });
});
