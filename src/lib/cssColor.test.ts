import { describe, expect, it } from "vitest";
import { parseCssColor, rgbaCss } from "./cssColor";

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
