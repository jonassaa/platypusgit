import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES, THEME_COLOR_FIELDS } from "@/features/settings/useSettingsStore";

import { contrastRatio } from "./contrast";
import { deriveTheme } from "./deriveTheme";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;

describe("deriveTheme", () => {
  it("puts the chosen accent in the accent slot", () => {
    expect(deriveTheme(dark, "#ff8800").accent).toBe("#ff8800");
  });

  it("leaves every other slot alone", () => {
    const derived = deriveTheme(dark, "#ff8800");
    for (const field of THEME_COLOR_FIELDS) {
      if (field.key === "accent" || field.key === "accentInk") continue;
      expect(derived[field.key], `${field.key} should be untouched`).toBe(
        dark.colors[field.key],
      );
    }
  });

  it("picks an ink that can actually be read on the accent", () => {
    // A mid-grey accent is the case that bites: neither of a theme's own
    // extremes may clear the bar, so the fallback to a pure extreme matters.
    for (const accent of ["#ffee00", "#0b1020", "#5aa8e8", "#7a7a7a", "#808080"]) {
      const derived = deriveTheme(dark, accent);
      expect(
        contrastRatio(derived.accentInk, derived.accent),
        `unreadable ink on ${accent}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("flips the ink across the light/dark crossover", () => {
    const onPale = deriveTheme(dark, "#ffee00").accentInk;
    const onDeep = deriveTheme(dark, "#101830").accentInk;
    expect(onPale).not.toBe(onDeep);
    // A pale accent takes the dark ink, a deep accent the light one.
    expect(contrastRatio(onPale, "#ffee00")).toBeGreaterThan(
      contrastRatio(onDeep, "#ffee00"),
    );
  });

  it("works from a light base too", () => {
    const derived = deriveTheme(light, "#8844cc");
    expect(derived.accent).toBe("#8844cc");
    expect(derived.bg0).toBe(light.colors.bg0);
    expect(contrastRatio(derived.accentInk, derived.accent)).toBeGreaterThanOrEqual(3);
  });

  it("normalizes a short hex and a missing hash", () => {
    expect(deriveTheme(dark, "f80").accent).toBe("#ff8800");
  });

  it("keeps the base accent when the input cannot be parsed", () => {
    expect(deriveTheme(dark, "nonsense").accent).toBe(dark.colors.accent);
    expect(deriveTheme(dark, "").accentInk).toBe(dark.colors.accentInk);
  });

  it("prefers the base's own inks when they are readable enough", () => {
    // Staying in the base's family is the point — jumping to pure black or
    // pure white on every derive would make every custom theme look the same.
    const derived = deriveTheme(dark, "#101830");
    expect(derived.accentInk).toBe(dark.colors.fg0);
  });
});
