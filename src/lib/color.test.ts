import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES, THEME_COLOR_FIELDS } from "@/features/settings/useSettingsStore";
import { srgbChromaCeiling } from "./cssColor";
import {
  COLOR_MODELS,
  colorModel,
  hexToHsv,
  hexToRgb,
  hslToRgb,
  hsvToHex,
  hsvToRgb,
  normalizeHex,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  trackStops,
} from "./color";

/** Every colour the built-in themes actually ship, as the round-trip corpus. */
const THEME_HEXES = BUILTIN_THEMES.flatMap((t) =>
  THEME_COLOR_FIELDS.map((f) => t.colors[f.key]),
);

const EDGES = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#808080"];

describe("hex", () => {
  it("writes six lowercase digits with a leading hash", () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 90, g: 168, b: 232 })).toBe("#5aa8e8");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
  });

  it("rounds and clamps a channel rather than emitting a bad digit", () => {
    expect(rgbToHex({ r: 89.6, g: -3, b: 999 })).toBe("#5a00ff");
  });

  it("reads the three- and six-digit forms, with or without the hash", () => {
    expect(hexToRgb("#5aa8e8")).toEqual({ r: 90, g: 168, b: 232 });
    expect(hexToRgb("5aa8e8")).toEqual({ r: 90, g: 168, b: 232 });
    expect(hexToRgb("#FFF")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("returns null for a string that is not a colour", () => {
    for (const junk of ["", "#12", "#12345", "rebeccapurple", "#gggggg"]) {
      expect(hexToRgb(junk)).toBeNull();
    }
  });

  it("normalizes to the canonical form", () => {
    expect(normalizeHex(" #ABC ")).toBe("#aabbcc");
    expect(normalizeHex("5AA8E8")).toBe("#5aa8e8");
    expect(normalizeHex("nope")).toBeNull();
  });
});

describe("hsv", () => {
  it("round-trips every colour the built-in themes ship", () => {
    for (const hex of [...THEME_HEXES, ...EDGES]) {
      expect(hsvToHex(rgbToHsv(hexToRgb(hex)!))).toBe(hex);
    }
  });

  it("puts the primaries on their own hue", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 1, v: 1 });
  });

  it("reads a grey as zero saturation", () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });

  it("clamps rather than wrapping an out-of-range hsv", () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 0, s: 2, v: -1 })).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("hexToHsv", () => {
  it("keeps the previous hue when the new colour is grey", () => {
    // The bug this exists to prevent: drag saturation to zero and the cursor
    // teleports to red, because a grey has no hue of its own to report.
    const prev = { h: 206, s: 0.61, v: 0.91 };
    expect(hexToHsv("#808080", prev).h).toBe(206);
  });

  it("keeps the previous hue AND saturation when the new colour is black", () => {
    // Same bug one axis further in: value at zero discards both, so dragging
    // back up returns a different colour than the one you left.
    const prev = { h: 206, s: 0.61, v: 0.91 };
    const at0 = hexToHsv("#000000", prev);
    expect(at0.h).toBe(206);
    expect(at0.s).toBe(0.61);
    expect(at0.v).toBe(0);
  });

  it("takes the new colour's own hue when it has one", () => {
    expect(hexToHsv("#00ff00", { h: 206, s: 0.61, v: 0.91 }).h).toBe(120);
  });

  it("falls back to black for an unreadable string", () => {
    expect(hexToHsv("nope")).toEqual({ h: 0, s: 0, v: 0 });
  });
});

describe("hsl", () => {
  it("round-trips every colour the built-in themes ship", () => {
    for (const hex of [...THEME_HEXES, ...EDGES]) {
      const rgb = hexToRgb(hex)!;
      expect(hslToRgb(rgbToHsl(rgb))).toEqual(rgb);
    }
  });

  it("puts a mid grey at half lightness and no saturation", () => {
    const hsl = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(hsl.s).toBe(0);
    expect(hsl.l).toBeCloseTo(128 / 255, 5);
  });
});

describe("COLOR_MODELS", () => {
  it("offers exactly the four the picker advertises", () => {
    expect(COLOR_MODELS.map((m) => m.id)).toEqual(["hsv", "hsl", "rgb", "oklch"]);
  });

  it("round-trips every theme colour through every model", () => {
    for (const model of COLOR_MODELS) {
      for (const hex of [...THEME_HEXES, ...EDGES]) {
        expect(model.write(model.read(hex))).toBe(hex);
      }
    }
  });

  it("moves the colour on a single step of any channel", () => {
    // The anti-stall property. A step finer than one 8-bit level would leave
    // the slider fighting the user: the handle moves, the colour does not, and
    // the next render snaps the handle back where it started.
    const hex = "#5aa8e8";
    for (const model of COLOR_MODELS) {
      const base = model.read(hex);
      model.channels.forEach((ch, i) => {
        const up = [...base];
        up[i] = Math.min(ch.max, base[i] + ch.step);
        const down = [...base];
        down[i] = Math.max(ch.min, base[i] - ch.step);
        expect(
          model.write(up) !== hex || model.write(down) !== hex,
          `${model.id}.${ch.key} does not move the colour in either direction`,
        ).toBe(true);
      });
    }
  });

  it("names every channel with a range a slider can lay out", () => {
    for (const model of COLOR_MODELS) {
      expect(model.channels.length).toBeGreaterThanOrEqual(3);
      for (const ch of model.channels) {
        expect(ch.max).toBeGreaterThan(ch.min);
        expect(ch.step).toBeGreaterThan(0);
        expect(ch.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("clamps a channel handed a value past its range", () => {
    const rgb = colorModel("rgb");
    expect(rgb.write([999, -5, 0])).toBe("#ff0000");
  });

  it("ends the oklch chroma track at the sRGB boundary", () => {
    const oklch = colorModel("oklch");
    const values = oklch.read("#5aa8e8");
    const ceiling = oklch.ceiling!(values, 1);
    expect(ceiling).toBeCloseTo(srgbChromaCeiling(values[0], values[2]), 6);
    // And it is a real ceiling for THIS colour, not a constant.
    expect(ceiling).toBeGreaterThan(values[1]);
    expect(ceiling).toBeLessThan(0.4);
  });

  it("has no ceiling to report for the models whose ranges are fixed", () => {
    for (const model of COLOR_MODELS.filter((m) => m.id !== "oklch")) {
      expect(model.ceiling).toBeUndefined();
    }
  });
});

describe("trackStops", () => {
  it("spans the channel from its own minimum to its own maximum", () => {
    const hsv = colorModel("hsv");
    const values = hsv.read("#5aa8e8");
    const stops = trackStops(hsv, values, 0);
    expect(stops.length).toBeGreaterThan(4);
    expect(stops[0]).toBe(hsv.write([hsv.channels[0].min, values[1], values[2]]));
    expect(stops[stops.length - 1]).toBe(
      hsv.write([hsv.channels[0].max, values[1], values[2]]),
    );
  });

  it("holds the other channels still", () => {
    // A saturation track has to stay on the colour's own hue, or the gradient
    // under the handle is not the colour the handle would pick.
    const hsv = colorModel("hsv");
    const values = hsv.read("#5aa8e8");
    for (const stop of trackStops(hsv, values, 1)) {
      const back = hsv.read(stop);
      expect(back[2]).toBeCloseTo(values[2], 2);
    }
  });

  it("walks a chroma track only as far as sRGB reaches", () => {
    const oklch = colorModel("oklch");
    const values = oklch.read("#5aa8e8");
    const stops = trackStops(oklch, values, 1);
    // The last stop is the boundary colour, not a clamped-and-hue-shifted one.
    const lastC = oklch.read(stops[stops.length - 1])[1];
    expect(lastC).toBeCloseTo(oklch.ceiling!(values, 1), 2);
  });
});
