import { describe, expect, it } from "vitest";
import {
  inSrgbGamut,
  oklchToRgb,
  parseCssColor,
  rgbToOklch,
  rgbaCss,
  srgbChromaCeiling,
} from "./cssColor";

describe("parseCssColor", () => {
  it("reads every hex length", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#1e222a")).toEqual({ r: 30, g: 34, b: 42, a: 1 });
    expect(parseCssColor("#0000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor("#ff000080")?.a).toBeCloseTo(128 / 255, 5);
  });

  it("reads rgb() in both the comma and the space form", () => {
    expect(parseCssColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor("rgb(1 2 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseCssColor("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it("converts oklch to sRGB", () => {
    // --git-added, dark calibration. Green must dominate, and it must be a mid
    // lightness rather than clipped.
    const added = parseCssColor("oklch(0.72 0.15 155)");
    expect(added).not.toBeNull();
    expect(added!.g).toBeGreaterThan(added!.r);
    expect(added!.g).toBeGreaterThan(added!.b);
    expect(added!.g).toBeGreaterThan(120);
    expect(added!.g).toBeLessThan(255);

    // --git-removed: red dominates.
    const removed = parseCssColor("oklch(0.68 0.18 25)")!;
    expect(removed.r).toBeGreaterThan(removed.g);
    expect(removed.r).toBeGreaterThan(removed.b);

    // --git-modified: amber, so red and green both high and blue low.
    const mod = parseCssColor("oklch(0.75 0.14 75)")!;
    expect(mod.b).toBeLessThan(mod.r);
    expect(mod.b).toBeLessThan(mod.g);
  });

  it("clamps the achromatic ends", () => {
    expect(parseCssColor("oklch(0 0 0)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("oklch(1 0 0)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    // Percentage lightness is the same value.
    expect(parseCssColor("oklch(100% 0 0)")).toEqual(parseCssColor("oklch(1 0 0)"));
  });

  it("carries oklch alpha through", () => {
    expect(parseCssColor("oklch(0.35 0.08 155 / 0.25)")?.a).toBe(0.25);
    expect(parseCssColor("oklch(0.35 0.08 155 / 25%)")?.a).toBe(0.25);
  });

  it("returns null rather than a string a canvas would ignore", () => {
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor(null)).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
    expect(parseCssColor("var(--git-added)")).toBeNull();
    expect(parseCssColor("rebeccapurple")).toBeNull();
    expect(parseCssColor("#12345")).toBeNull();
    expect(parseCssColor("oklch(0.7 0.1)")).toBeNull();
    expect(parseCssColor("color-mix(in oklab, red, blue)")).toBeNull();
  });

  it("reads transparent as a zero-alpha colour", () => {
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe("rgbaCss", () => {
  it("emits rgb() at full alpha and rgba() below it", () => {
    expect(rgbaCss({ r: 1, g: 2, b: 3, a: 1 })).toBe("rgb(1, 2, 3)");
    expect(rgbaCss({ r: 1, g: 2, b: 3, a: 0.5 })).toBe("rgba(1, 2, 3, 0.5)");
  });

  it("multiplies rather than replaces the colour's own alpha", () => {
    expect(rgbaCss({ r: 1, g: 2, b: 3, a: 0.5 }, 0.5)).toBe("rgba(1, 2, 3, 0.25)");
    expect(rgbaCss({ r: 1, g: 2, b: 3, a: 1 }, 0.1)).toBe("rgba(1, 2, 3, 0.1)");
  });
});

describe("rgbToOklch", () => {
  it("round-trips every channel corner back to the same bytes", () => {
    // The picker's OKLCH sliders read this inverse and write the forward
    // direction, so a lossy pair would drift the value every time the popover
    // was opened and closed.
    for (const rgb of [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 90, g: 168, b: 232 }, // dark-cool's accent
      { r: 45, g: 50, b: 60 }, // a near-grey border, the common case here
    ]) {
      const { l, c, h } = rgbToOklch(rgb);
      expect(oklchToRgb(l, c, h)).toEqual(rgb);
    }
  });

  it("reports a grey as zero chroma", () => {
    expect(rgbToOklch({ r: 128, g: 128, b: 128 }).c).toBeCloseTo(0, 6);
  });

  it("agrees with the forward parse on a known token", () => {
    const rgb = parseCssColor("oklch(0.72 0.15 155)")!;
    const back = rgbToOklch(rgb);
    expect(back.l).toBeCloseTo(0.72, 2);
    expect(back.c).toBeCloseTo(0.15, 2);
    expect(back.h).toBeCloseTo(155, 0);
  });
});

describe("srgbChromaCeiling", () => {
  it("finds a ceiling a hair inside the gamut, never outside it", () => {
    for (const [l, h] of [
      [0.72, 155],
      [0.5, 25],
      [0.85, 300],
    ] as const) {
      const c = srgbChromaCeiling(l, h);
      // In gamut at the ceiling…
      expect(inSrgbGamut(l, c, h)).toBe(true);
      // …and out of it a step beyond, which is what makes it a CEILING and not
      // merely some safe small number.
      expect(inSrgbGamut(l, c + 0.02, h)).toBe(false);
    }
  });

  it("leaves the achromatic ends with nowhere to go", () => {
    expect(srgbChromaCeiling(0, 200)).toBeCloseTo(0, 2);
    expect(srgbChromaCeiling(1, 200)).toBeCloseTo(0, 2);
  });

  it("keeps an in-gamut colour's own chroma reachable", () => {
    // A colour that came FROM sRGB must not be pushed inward by its own ceiling.
    const { l, c, h } = rgbToOklch({ r: 90, g: 168, b: 232 });
    expect(srgbChromaCeiling(l, h)).toBeGreaterThanOrEqual(c);
  });
});
