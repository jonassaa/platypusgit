// Colour conversions and the picker's model registry, in TypeScript.
//
// The division of labour with `cssColor.ts` next door: that module PARSES what
// CSS can say (including `oklch()`, which the Linux webview cannot) so a canvas
// can be handed a colour. This one converts between the spaces a HUMAN moves —
// hex, HSV, HSL, OKLCh — for `PGColorPicker`. The OKLab matrices live in
// `cssColor.ts` and are imported here rather than copied: two sets of
// Ottosson's constants in one tree is a drift waiting to happen.
//
// Everything here is pure and DOM-free, which is the point: the picker's
// interesting behaviour is arithmetic (does a step move the colour, does a grey
// keep its hue, where does sRGB run out), and arithmetic is testable without
// laying out a wheel that jsdom would measure as 0×0 anyway.

import { oklchToRgb, rgbToOklch, srgbChromaCeiling } from "./cssColor";

/** sRGB, 0-255 per channel. Integers once it has been through [`rgbToHex`]. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue 0-360, saturation and value 0-1. The picker's own state. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Hue 0-360, saturation and lightness 0-1. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const byte = (n: number) => clamp(Math.round(n), 0, 255);

// ─── Hex ─────────────────────────────────────────────────────────────────────

/**
 * sRGB → the canonical `#rrggbb`, always six lowercase digits.
 *
 * Canonical matters more than it looks: `ThemeColors` compares hex strings to
 * decide whether a draft is still untouched, so `#FFF` and `#ffffff` being the
 * same colour but different strings would make the theme editor's "Revert"
 * offer itself against a draft nobody edited.
 */
export function rgbToHex(rgb: Rgb): string {
  const hex = (n: number) => byte(n).toString(16).padStart(2, "0");
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}

/** `#abc`, `#aabbcc`, or either without the hash. Null for anything else. */
export function hexToRgb(value: string): Rgb | null {
  const raw = value.trim().toLowerCase().replace(/^#/, "");
  if (!/^[0-9a-f]+$/.test(raw)) return null;
  if (raw.length === 3) {
    return {
      r: Number.parseInt(raw[0] + raw[0], 16),
      g: Number.parseInt(raw[1] + raw[1], 16),
      b: Number.parseInt(raw[2] + raw[2], 16),
    };
  }
  if (raw.length === 6) {
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}

/** A user-typed colour as canonical `#rrggbb`, or null when it is not one. */
export function normalizeHex(value: string): string | null {
  const rgb = hexToRgb(value);
  return rgb ? rgbToHex(rgb) : null;
}

// ─── HSV ─────────────────────────────────────────────────────────────────────

export function rgbToHsv(rgb: Rgb): Hsv {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: h < 0 ? h + 360 : h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(hsv: Hsv): Rgb {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp(hsv.s, 0, 1);
  const v = clamp(hsv.v, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector];
  return { r: byte((r + m) * 255), g: byte((g + m) * 255), b: byte((b + m) * 255) };
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

/**
 * A hex string as HSV, keeping whatever the previous HSV still knows.
 *
 * HSV loses information at two edges and the picker has to survive both. A grey
 * has no hue: read it naively and the wheel's cursor teleports to red the
 * instant saturation reaches zero. Black has neither hue nor saturation: drag
 * value to the floor and back, and without this you come up somewhere else
 * entirely. So the previous angle survives the trip, and only what the new
 * colour genuinely determines is taken from it.
 */
export function hexToHsv(value: string, prev?: Hsv): Hsv {
  const rgb = hexToRgb(value);
  if (!rgb) return prev ? { ...prev, v: 0 } : { h: 0, s: 0, v: 0 };
  const next = rgbToHsv(rgb);
  if (!prev) return next;
  return {
    h: next.s === 0 ? prev.h : next.h,
    s: next.v === 0 ? prev.s : next.s,
    v: next.v,
  };
}

// ─── HSL ─────────────────────────────────────────────────────────────────────

export function rgbToHsl(rgb: Rgb): Hsl {
  const { h, s: sv, v } = rgbToHsv(rgb);
  const l = v * (1 - sv / 2);
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return { h, s, l };
}

export function hslToRgb(hsl: Hsl): Rgb {
  const l = clamp(hsl.l, 0, 1);
  const s = clamp(hsl.s, 0, 1);
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb({ h: hsl.h, s: v === 0 ? 0 : 2 * (1 - l / v), v });
}

// ─── The model registry ──────────────────────────────────────────────────────

export interface ColorChannel {
  /** Stable key, for a test and for React. */
  key: string;
  /** The one- or two-letter label beside the slider. */
  label: string;
  /** Spelt out for the slider's accessible name. */
  name: string;
  min: number;
  max: number;
  /** One arrow-key press. Never finer than one 8-bit level — see the test. */
  step: number;
  /** Suffix in the readout: `°`, `%`, or nothing. */
  unit: string;
  /** Decimal places in the readout. */
  places: number;
  /** Multiplier between the stored value and the readout (0-1 shown as 0-100). */
  scale: number;
}

export interface ColorModel {
  id: "hsv" | "hsl" | "rgb" | "oklch";
  label: string;
  channels: ColorChannel[];
  /**
   * The channel values for a colour, UNROUNDED.
   *
   * Unrounded on purpose: the readout rounds for display, but editing one
   * channel keeps the others exactly as they were. Storing the rounded values
   * instead would drag the colour a byte sideways every time you touched an
   * unrelated slider.
   */
  read(hex: string): number[];
  /** The colour those channel values name. Clamps; never throws. */
  write(values: number[]): string;
  /**
   * A channel's real upper bound given the others, where it is not `max`.
   *
   * Only OKLCh has one: chroma's ceiling depends on lightness and hue, and a
   * track that ignores it spends its last third doing nothing while the
   * per-channel clamp shifts the hue.
   */
  ceiling?(values: number[], index: number): number;
}

const pct = (key: string, label: string, name: string): ColorChannel => ({
  key,
  label,
  name,
  min: 0,
  max: 1,
  // 1% — a hair under three 8-bit levels, so one arrow press always lands on a
  // different colour.
  step: 0.01,
  unit: "%",
  places: 0,
  scale: 100,
});

const hueChannel: ColorChannel = {
  key: "h",
  label: "H",
  name: "Hue",
  min: 0,
  max: 360,
  step: 1,
  unit: "°",
  places: 0,
  scale: 1,
};

const rgbChannel = (key: string, label: string, name: string): ColorChannel => ({
  key,
  label,
  name,
  min: 0,
  max: 255,
  step: 1,
  unit: "",
  places: 0,
  scale: 1,
});

export const COLOR_MODELS: ColorModel[] = [
  {
    id: "hsv",
    label: "HSV",
    channels: [hueChannel, pct("s", "S", "Saturation"), pct("v", "V", "Value")],
    read: (hex) => {
      const { h, s, v } = rgbToHsv(hexToRgb(hex) ?? { r: 0, g: 0, b: 0 });
      return [h, s, v];
    },
    write: ([h, s, v]) => hsvToHex({ h, s, v }),
  },
  {
    id: "hsl",
    label: "HSL",
    channels: [hueChannel, pct("s", "S", "Saturation"), pct("l", "L", "Lightness")],
    read: (hex) => {
      const { h, s, l } = rgbToHsl(hexToRgb(hex) ?? { r: 0, g: 0, b: 0 });
      return [h, s, l];
    },
    write: ([h, s, l]) => rgbToHex(hslToRgb({ h, s, l })),
  },
  {
    id: "rgb",
    label: "RGB",
    channels: [
      rgbChannel("r", "R", "Red"),
      rgbChannel("g", "G", "Green"),
      rgbChannel("b", "B", "Blue"),
    ],
    read: (hex) => {
      const { r, g, b } = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
      return [r, g, b];
    },
    write: ([r, g, b]) => rgbToHex({ r, g, b }),
  },
  {
    id: "oklch",
    label: "OKLCH",
    channels: [
      {
        key: "l",
        label: "L",
        name: "Lightness",
        min: 0,
        max: 1,
        // 0.5% of perceptual lightness — just over one 8-bit level in the mid
        // range, which is where every grey slot in a theme sits.
        step: 0.005,
        unit: "%",
        places: 1,
        scale: 100,
      },
      {
        key: "c",
        label: "C",
        name: "Chroma",
        min: 0,
        // CSS's own 100% for oklch chroma. The reachable end is `ceiling`.
        max: 0.4,
        step: 0.005,
        unit: "",
        places: 3,
        scale: 1,
      },
      hueChannel,
    ],
    read: (hex) => {
      const { l, c, h } = rgbToOklch(hexToRgb(hex) ?? { r: 0, g: 0, b: 0 });
      return [l, c, h];
    },
    write: ([l, c, h]) =>
      rgbToHex(oklchToRgb(clamp(l, 0, 1), Math.max(0, c), h)),
    ceiling: ([l, , h], index) => (index === 1 ? srgbChromaCeiling(l, h) : Infinity),
  },
];

/** The model with this id. Throws only on a typo, which the union prevents. */
export function colorModel(id: ColorModel["id"]): ColorModel {
  return COLOR_MODELS.find((m) => m.id === id)!;
}

/** How many colours a slider's gradient is built from. */
const TRACK_STOPS = 16;

/**
 * The colours a channel's slider track is painted with, left to right.
 *
 * Sampled rather than hand-written per model, which is what lets OKLCh have a
 * correct track for free — and what makes the track honest: every stop is the
 * colour that position would actually pick, so the gradient under the handle is
 * a preview rather than a decoration. Where a channel has a [`ColorModel.ceiling`],
 * the track stops there instead of running on into clamped, hue-shifted colours
 * the handle can never reach.
 */
export function trackStops(
  model: ColorModel,
  values: number[],
  index: number,
): string[] {
  const ch = model.channels[index];
  const hi = Math.min(ch.max, model.ceiling?.(values, index) ?? Infinity);
  const out: string[] = [];
  for (let i = 0; i <= TRACK_STOPS; i++) {
    const next = [...values];
    next[index] = ch.min + ((hi - ch.min) * i) / TRACK_STOPS;
    out.push(model.write(next));
  }
  return out;
}
