// Light themes must remap the semantic token sets, not just bg/fg/border/accent
// (#61 B4). Before this, --git-*, --graph-*, --accent-2..5, --shadow-* and the
// selection tints kept their dark calibration on a light canvas.

import { describe, it, expect, afterEach } from "vitest";
import { BUILTIN_THEMES, applyTheme, type ThemeDef } from "./useSettingsStore";

const root = () => document.documentElement;
const token = (name: string) => root().style.getPropertyValue(name).trim();

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;
const githubLight = BUILTIN_THEMES.find((t) => t.id === "github-light")!;

/** The sets that used to be left behind entirely. */
const SEMANTIC_NAMES = [
  "--git-added",
  "--git-added-bg",
  "--git-added-gutter",
  "--git-removed",
  "--git-removed-bg",
  "--git-removed-gutter",
  "--git-modified",
  "--git-modified-bg",
  "--git-renamed",
  "--git-conflict",
  "--git-untracked",
  "--git-staged",
  "--git-ignored",
  "--graph-1",
  "--graph-2",
  "--graph-3",
  "--graph-4",
  "--graph-5",
  "--graph-6",
  "--graph-7",
  "--accent-2",
  "--accent-3",
  "--accent-4",
  "--accent-5",
  "--shadow-1",
  "--shadow-2",
  "--shadow-3",
  "--shadow-inset",
  "--bg-selection",
  "--bg-selection-dim",
  "--bg-selection-focused",
];

afterEach(() => {
  // Leave the document on the default theme for other suites.
  applyTheme(dark);
});

describe("applyTheme semantic remap (#61 B4)", () => {
  it("writes every semantic token for a dark theme", () => {
    applyTheme(dark);
    for (const name of SEMANTIC_NAMES) {
      expect(token(name), name).not.toBe("");
    }
  });

  it("writes a DIFFERENT value for every semantic token on a light theme", () => {
    applyTheme(dark);
    const before = Object.fromEntries(SEMANTIC_NAMES.map((n) => [n, token(n)]));

    applyTheme(light);
    for (const name of SEMANTIC_NAMES) {
      expect(token(name), name).not.toBe("");
      expect(token(name), `${name} must be recalibrated for light mode`).not.toBe(
        before[name],
      );
    }
  });

  it("restores the dark calibration when switching back", () => {
    applyTheme(dark);
    const darkTokens = Object.fromEntries(SEMANTIC_NAMES.map((n) => [n, token(n)]));

    applyTheme(light);
    applyTheme(dark);

    // A stale light calibration surviving a switch back was the failure mode
    // that made "write only on mode change" the wrong shortcut.
    for (const name of SEMANTIC_NAMES) {
      expect(token(name), name).toBe(darkTokens[name]);
    }
  });

  it("uses the same light calibration for every light theme", () => {
    applyTheme(light);
    const a = Object.fromEntries(SEMANTIC_NAMES.map((n) => [n, token(n)]));
    applyTheme(githubLight);
    for (const name of SEMANTIC_NAMES) {
      // …except the accent-derived selection tints, which follow --accent and
      // so are theme-specific by design. They are declared relative to
      // var(--accent), so the literal text still matches.
      expect(token(name), name).toBe(a[name]);
    }
  });

  it("derives selection tints from the accent, not a hardcoded hue", () => {
    applyTheme(dark);
    for (const name of [
      "--bg-selection",
      "--bg-selection-dim",
      "--bg-selection-focused",
    ]) {
      expect(token(name), name).toContain("var(--accent)");
    }
  });

  it("treats an unknown mode as dark rather than emitting nothing", () => {
    // Persisted/imported themes are only loosely validated, so mode can be a
    // string this build has never heard of. Half-written tokens would be worse
    // than a wrong-but-consistent calibration.
    applyTheme(dark);
    const darkTokens = Object.fromEntries(SEMANTIC_NAMES.map((n) => [n, token(n)]));

    applyTheme(light);
    applyTheme({ ...dark, mode: "sepia" as unknown as ThemeDef["mode"] });

    for (const name of SEMANTIC_NAMES) {
      expect(token(name), name).toBe(darkTokens[name]);
    }
  });
});
