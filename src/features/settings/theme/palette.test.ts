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
import { deriveTheme } from "./deriveTheme";
import {
  HARMONY_RULES,
  NO_LOCKS,
  RAMP_SLOTS,
  familyHue,
  generate,
  harmonyOffsets,
  inferTraits,
  isGenerated,
  rollTraits,
  tintRamp,
} from "./palette";

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

describe("harmony", () => {
  it("never gives the two logo slots the same hue", () => {
    // A literal mirror collapses at 0 and at 180, which is why Monochrome and
    // Complementary are nudged. Without the nudge the mark loses one of its two
    // colours on exactly those rules.
    for (const rule of HARMONY_RULES) {
      expect(hueApart(rule.logo, rule.logo2), rule.id).toBeGreaterThan(1);
    }
  });

  it("keeps Monochrome's ground on the seed and defaults to Analogous", () => {
    expect(harmonyOffsets("mono").ground).toBe(0);
    expect(HARMONY_RULES[1].id).toBe("analogous");
  });
});

describe("generate", () => {
  const base = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
  const traits = {
    baseId: base.id,
    seed: "#5aa8e8",
    rule: "analogous" as const,
    strength: 0.35,
  };

  it("puts the seed in the accent slot untouched", () => {
    expect(generate(base, traits).accent).toBe("#5aa8e8");
  });

  it("reproduces every base's ramp exactly at strength 0, under every rule", () => {
    // What makes opening the editor safe: the generator's neutral position IS
    // the theme you started from, whatever rule happens to be selected.
    //
    // This has to hold for EVERY rule, not just the nearest one. A rule's ground
    // offset is a quantised angle while a base's own offset is whatever it is —
    // dark-cool sits at 18.6 degrees and no rule has that — so a version that
    // rotated the ramp at strength 0 moved bg0 from #1a1d24 to #1b1d24 before
    // the user touched anything. Caught by this test being written the strong way.
    for (const t of BUILTIN_THEMES) {
      for (const rule of HARMONY_RULES) {
        const out = generate(t, {
          baseId: t.id,
          seed: t.colors.accent,
          rule: rule.id,
          strength: 0,
        });
        for (const key of RAMP_SLOTS) {
          expect(out[key], `${t.id} under ${rule.id}: ${key}`).toBe(t.colors[key]);
        }
      }
    }
  });

  it("moves the ground with the rule but never the accent", () => {
    const mono = generate(base, { ...traits, rule: "mono" });
    const comp = generate(base, { ...traits, rule: "complementary" });
    expect(mono.accent).toBe(comp.accent);
    expect(hueApart(familyHue(comp)!, familyHue(mono)!)).toBeGreaterThan(150);
  });

  it("keeps the button label readable on every generated accent", () => {
    for (const seed of ["#ffee00", "#0b1020", "#5aa8e8", "#7a7a7a", "#808080"]) {
      const out = generate(base, { ...traits, seed });
      expect(contrastRatio(out.accentInk, out.accent), seed).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns the base untouched for a seed that is not a colour", () => {
    // A half-typed hex is not a palette. The editor's own field keeps the text.
    expect(generate(base, { ...traits, seed: "not a colour" })).toEqual(base.colors);
  });

  it("degenerates to deriveTheme at tint 0", () => {
    // Tint is the one master control: at 0 this is exactly the accent swap that
    // shipped before it, at 1 a fully generated palette. Asserting it against
    // `deriveTheme` itself is what stops the two drifting into two answers.
    for (const t of BUILTIN_THEMES) {
      for (const rule of HARMONY_RULES) {
        for (const seed of ["#5aa8e8", "#ffee00", "#7a7a7a"]) {
          expect(
            generate(t, { baseId: t.id, seed, rule: rule.id, strength: 0 }),
            `${t.id} / ${rule.id} / ${seed}`,
          ).toEqual(deriveTheme(t, seed));
        }
      }
    }
  });
});

describe("inferTraits", () => {
  it("round-trips every built-in's ramp to itself", () => {
    // No new file format: the traits are read back out of the palette, and
    // because strength 0 leaves the ramp alone, opening any theme regenerates
    // its surfaces exactly. This is what lets themePayload stay untouched.
    for (const t of BUILTIN_THEMES) {
      const traits = inferTraits(t);
      expect(traits.seed, t.id).toBe(t.colors.accent);
      expect(traits.strength, t.id).toBe(0);
      expect(traits.baseId, t.id).toBe(t.id);
      const out = generate(t, traits);
      for (const key of RAMP_SLOTS) expect(out[key], `${t.id}.${key}`).toBe(t.colors[key]);
    }
  });

  it("names the rule the theme actually uses", () => {
    // Measured surface-to-accent angles: dark-warm 1.1, dark-cool 18.6,
    // dracula -29.0, solarized-dark -30.1. The last two are what pin the
    // MAGNITUDE match — signed matching would call both of them Custom.
    const rule = (id: string) => inferTraits(BUILTIN_THEMES.find((t) => t.id === id)!).rule;
    expect(rule("dark-warm")).toBe("mono");
    expect(rule("dark-cool")).toBe("analogous");
    expect(rule("dracula")).toBe("analogous");
    expect(rule("solarized-dark")).toBe("analogous");
  });

  it("falls back to the default rule when the ramp has no hue", () => {
    const neutral = BUILTIN_THEMES.find((t) => t.id === "dark-neutral")!;
    expect(inferTraits(neutral).rule).toBe("analogous");
  });
});

describe("isGenerated", () => {
  it("is true for every built-in as it opens", () => {
    // All nine, not one: the bug this caught was theme-specific. A built-in's
    // hand-authored `accentInk` is not what `inkFor` would pick off its ramp,
    // so comparing that slot made every theme read as "Custom" on open.
    for (const t of BUILTIN_THEMES) {
      expect(isGenerated(t.colors, t, inferTraits(t)), t.id).toBe(true);
    }
  });

  it("goes false as soon as a slot is hand-edited", () => {
    const base = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
    const traits = inferTraits(base);
    expect(isGenerated({ ...base.colors, border1: "#ff00ff" }, base, traits)).toBe(false);
    expect(isGenerated({ ...base.colors, bg0: "#ff00ff" }, base, traits)).toBe(false);
    expect(isGenerated({ ...base.colors, accent: "#ff00ff" }, base, traits)).toBe(false);
  });
});

describe("rollTraits", () => {
  const base = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
  const traits = inferTraits(base);
  /** A scripted source, so a roll is a fixture rather than a coin toss. */
  const scripted = (...xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length];
  };

  it("respects every lock", () => {
    const locked = { base: true, seed: true, rule: true, strength: true };
    expect(rollTraits(traits, locked, "dark", BUILTIN_THEMES, scripted(0.5))).toEqual(
      traits,
    );
  });

  it("changes what is not locked", () => {
    const locks = { ...NO_LOCKS, seed: true };
    const out = rollTraits(traits, locks, "dark", BUILTIN_THEMES, scripted(0.1, 0.9, 0.4, 0.7));
    expect(out.seed).toBe(traits.seed);
    expect(out.strength).not.toBe(traits.strength);
  });

  it("keeps the seed inside the band the built-in accents occupy", () => {
    // L 0.52-0.78 and C 0.06-0.19 are the measured span of the nine built-in
    // accents, which is why a rolled theme never lands somewhere unusable.
    for (let i = 0; i < 200; i++) {
      const out = rollTraits(traits, NO_LOCKS, "dark", BUILTIN_THEMES);
      const o = oklch(out.seed);
      expect(o.l).toBeGreaterThanOrEqual(0.51);
      expect(o.l).toBeLessThanOrEqual(0.79);
      expect(out.strength).toBeGreaterThanOrEqual(0.15);
      expect(out.strength).toBeLessThanOrEqual(0.7);
    }
  });

  it("only rolls built-in bases of the draft's own mode", () => {
    for (let i = 0; i < 100; i++) {
      const out = rollTraits(traits, NO_LOCKS, "light", BUILTIN_THEMES);
      const picked = BUILTIN_THEMES.find((t) => t.id === out.baseId)!;
      expect(picked.mode).toBe("light");
      expect(picked.builtin).toBe(true);
    }
  });

  it("never rolls a strength of zero", () => {
    // A dice press that changes nothing visible reads as a broken button.
    for (let i = 0; i < 100; i++) {
      expect(
        rollTraits(traits, NO_LOCKS, "dark", BUILTIN_THEMES).strength,
      ).toBeGreaterThan(0);
    }
  });
});
