// The palette generator's arithmetic.
//
// These tests are the ARGUMENT, not decoration. The 2026-09-09 spec ruled a
// palette generator out because one "produces palettes the user cannot predict
// or correct", and the reversal is only defensible if the two properties that
// objection names are measurable: strength 0 reproduces the base byte-for-byte
// (predictable), and tinting cannot move a contrast pair across an AA boundary
// (correct, in the sense that it never silently breaks the theme).
//
// So the numbers here are load-bearing. A failure is a re-measurement, never a
// loosened bound.

import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES } from "@/features/settings/useSettingsStore";
import { hexToRgb } from "@/lib/color";
import { rgbToOklch } from "@/lib/cssColor";

import { contrastRatio } from "./contrast";
import { RAMP_SLOTS, familyHue, tintRamp } from "./palette";

const oklch = (hex: string) => rgbToOklch(hexToRgb(hex)!);

/**
 * The three ramp pairs.
 *
 * `accentInk`/`accent` is deliberately absent: the accent is a seed and is never
 * tinted, so sweeping it here would measure `inkFor`, which `deriveTheme.test.ts`
 * already pins.
 */
const RAMP_PAIRS = [
  ["fg0", "bg0"],
  ["fg1", "bg1"],
  ["fg2", "bg1"],
] as const;

const CHROMA_FLOOR = 0.004;

/** Circular distance between two hues, in degrees, 0 to 180. */
const hueApart = (a: number, b: number) =>
  Math.abs(((((a - b) % 360) + 540) % 360) - 180);

const band = (r: number) => (r < 3 ? "bad" : r < 4.5 ? "low" : "ok");

describe("familyHue", () => {
  it("is null only for a fully achromatic ramp", () => {
    // Measured: of the nine built-ins, dark-neutral alone has no slot above the
    // chroma floor. light, gruvbox-dark and github-light have achromatic
    // BACKGROUNDS but still resolve a hue from the rest of the ramp.
    for (const t of BUILTIN_THEMES) {
      const hue = familyHue(t.colors);
      if (t.id === "dark-neutral") expect(hue, t.id).toBeNull();
      else expect(hue, t.id).not.toBeNull();
    }
  });

  it("lands on the hue the ramp actually reads as", () => {
    // Measured chroma-weighted circular means, to the nearest degree.
    const expected: Record<string, number> = {
      "dark-cool": 264,
      "dark-warm": 68,
      light: 259,
      nord: 264,
      dracula: 273,
      "solarized-dark": 215,
      "gruvbox-dark": 79,
      "github-light": 251,
    };
    for (const [id, want] of Object.entries(expected)) {
      const t = BUILTIN_THEMES.find((x) => x.id === id)!;
      expect(familyHue(t.colors)!, id).toBeCloseTo(want, -0.5);
    }
  });
});

describe("tintRamp", () => {
  it("is the exact identity at strength 0 on the family hue", () => {
    // The guarantee the whole panel rests on: opening the editor and touching
    // nothing must not move a single byte. Measured 0/14 slots differ across
    // all nine built-ins, worst channel error 0.
    for (const t of BUILTIN_THEMES) {
      const hue = familyHue(t.colors) ?? 0;
      const out = tintRamp(t.colors, hue, 0);
      for (const key of RAMP_SLOTS) {
        expect(out[key], `${t.id}.${key}`).toBe(t.colors[key]);
      }
    }
  });

  it("never changes a contrast verdict, at any hue or strength", () => {
    // 9 themes x 24 hues x 5 strengths x 3 pairs = 3240 checks, measured at
    // 0 band changes. This is what replaces the old non-goal's argument, so a
    // failure here means re-measuring the model, not relaxing the assertion.
    let checks = 0;
    for (const t of BUILTIN_THEMES) {
      for (let hue = 0; hue < 360; hue += 15) {
        for (const strength of [0, 0.25, 0.5, 0.75, 1]) {
          const out = tintRamp(t.colors, hue, strength);
          for (const [a, b] of RAMP_PAIRS) {
            const before = band(contrastRatio(t.colors[a], t.colors[b]));
            const after = band(contrastRatio(out[a], out[b]));
            expect(after, `${t.id} hue=${hue} strength=${strength} ${a}/${b}`).toBe(
              before,
            );
            checks++;
          }
        }
      }
    }
    expect(checks).toBe(3240);
  });

  it("holds every slot's lightness exactly", () => {
    const base = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!.colors;
    const out = tintRamp(base, 300, 0.6);
    for (const key of RAMP_SLOTS) {
      // 8-bit quantization is the only source of drift, so a tight bound.
      expect(oklch(out[key]).l, key).toBeCloseTo(oklch(base[key]).l, 2);
    }
  });

  it("delivers the hue it was asked for rather than letting a clip shift it", () => {
    // The ceiling clamp's real job. Asserting the OUTPUT's chroma is under the
    // ceiling proves nothing — every 8-bit colour is in gamut by construction,
    // so that assertion cannot fail even with the clamp deleted. What a missing
    // clamp actually does is clip per channel, and an unevenly clipped channel
    // moves the HUE. Verified by planting it: removing the clamp fails this.
    //
    // dark-neutral is the clean case: it has no family hue, so every slot is
    // asked for exactly `hue` and there is no rotation to account for.
    const base = BUILTIN_THEMES.find((t) => t.id === "dark-neutral")!.colors;
    for (const hue of [0, 90, 180, 270]) {
      const out = tintRamp(base, hue, 1);
      for (const key of RAMP_SLOTS) {
        const o = oklch(out[key]);
        if (o.c < CHROMA_FLOOR) continue; // near-black and near-white carry none
        // Circular distance, not a raw compare: hue wraps, and 359.8 is two
        // tenths of a degree from 0, not 359.8 of them.
        expect(hueApart(o.h, hue), `${key} at hue ${hue}`).toBeLessThan(2.5);
      }
    }
  });

  it("tints a ramp that has no hue of its own", () => {
    // A multiplier cannot do this: dark-neutral is chroma 0 in all 14 slots,
    // and any multiple of zero is zero.
    const base = BUILTIN_THEMES.find((t) => t.id === "dark-neutral")!.colors;
    expect(tintRamp(base, 300, 0).bg0).toBe(base.bg0);
    expect(tintRamp(base, 300, 1).bg0).not.toBe(base.bg0);
    expect(oklch(tintRamp(base, 300, 1).bg0).c).toBeGreaterThan(0.01);
  });

  it("rotates rather than assigns, so a theme keeps its own hue split", () => {
    // dracula puts its text 171 degrees from its backgrounds on purpose.
    // Assigning one hue flattens that; rotating preserves it.
    const base = BUILTIN_THEMES.find((t) => t.id === "dracula")!.colors;
    const split = (c: typeof base) => hueApart(oklch(c.fg0).h, oklch(c.bg0).h);
    for (const target of [0, 120, 210]) {
      expect(split(tintRamp(base, target, 0.4)), `target ${target}`).toBeCloseTo(
        split(base),
        -0.5,
      );
    }
  });
});
