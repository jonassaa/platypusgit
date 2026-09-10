// Parse a CSS colour token into sRGB bytes, in TypeScript.
//
// Exists because a canvas cannot be handed a CSS variable, and the values behind
// this app's variables are `oklch(...)`. `applyTheme` writes the semantic tokens
// as inline custom properties on `:root`, and a custom property computes to its
// declared TOKEN STREAM — so `getComputedStyle(root).getPropertyValue("--git-added")`
// returns the literal `oklch(0.72 0.15 155)` on every engine, parsed or not.
//
// That string must not reach `ctx.fillStyle`. WebKitGTK 605 — the Linux webview
// and the e2e target — predates `oklch()` by years, and assigning an unparseable
// colour to `fillStyle` is a silent NO-OP: the previous fill stays, so a canvas
// would paint with whatever came before (black, on the first draw) while looking
// correct on macOS. Converting here makes the render byte-identical across engines
// instead of merely non-black on one of them.

export interface Rgba {
  /** 0-255, integer. */
  r: number;
  /** 0-255, integer. */
  g: number;
  /** 0-255, integer. */
  b: number;
  /** 0-1. */
  a: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const byte = (n: number) => Math.round(clamp01(n) * 255);

/** `0.5` or `50%` → 0.5. Returns NaN for anything else, which callers reject. */
function scalar(raw: string, pctBase: number): number {
  const s = raw.trim();
  if (s.endsWith("%")) {
    const n = Number.parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? (n / 100) * pctBase : Number.NaN;
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * sRGB transfer function (linear light → encoded), the same curve the CSS spec
 * names for every conversion out of a linear-light space.
 */
function gamma(c: number): number {
  const x = c < 0 ? 0 : c;
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** The inverse of [`gamma`] — encoded sRGB → linear light. */
function degamma(c: number): number {
  const x = c < 0 ? 0 : c;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/**
 * OKLCh → LINEAR sRGB, unclamped (Björn Ottosson's matrices).
 *
 * Unclamped is the whole point of the split: a channel outside `[0, 1]` here is
 * how [`inSrgbGamut`] knows the colour is unrepresentable, and clamping first
 * would erase exactly that signal.
 */
function oklchToLinearSrgb(
  L: number,
  C: number,
  hDeg: number,
): { r: number; g: number; b: number } {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/**
 * OKLCh → sRGB bytes, via OKLab and linear sRGB.
 *
 * Out-of-gamut values are clamped per channel rather than gamut-mapped. Every
 * token this parses is already inside sRGB — they were authored against a
 * browser rendering them — so the clamp is a guard, not the normal path. A
 * caller that lets a HUMAN move chroma is the exception, and reaches for
 * [`srgbChromaCeiling`] instead of discovering the clamp as a hue shift.
 */
export function oklchToRgb(
  L: number,
  C: number,
  hDeg: number,
): { r: number; g: number; b: number } {
  const lin = oklchToLinearSrgb(L, C, hDeg);
  return { r: byte(gamma(lin.r)), g: byte(gamma(lin.g)), b: byte(gamma(lin.b)) };
}

/** OKLCh, the shape the colour picker's sliders read and write. */
export interface Oklch {
  /** Perceptual lightness, 0-1. */
  l: number;
  /** Chroma, 0 to about 0.37 inside sRGB. See [`srgbChromaCeiling`]. */
  c: number;
  /** Hue angle in degrees, `[0, 360)`. */
  h: number;
}

/**
 * sRGB bytes → OKLCh, the exact inverse of [`oklchToRgb`].
 *
 * Round-trip exactness is the requirement, not an accident: the picker holds
 * HSV as its state and derives OKLCh on every render, so a lossy pair would
 * walk the value a little further every time the popover opened.
 */
export function rgbToOklch(rgb: { r: number; g: number; b: number }): Oklch {
  const r = degamma(rgb.r / 255);
  const g = degamma(rgb.g / 255);
  const b = degamma(rgb.b / 255);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(a * a + bb * bb);
  const hDeg = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: L, c, h: hDeg < 0 ? hDeg + 360 : hDeg };
}

/**
 * The largest chroma sRGB can show at this lightness and hue.
 *
 * Bisection rather than a formula because the sRGB gamut's shape in OKLab has
 * no closed form. Two facts make it sound: the achromatic axis is inside the
 * cube for every `0 < L < 1`, and the cube is convex — so a ray leaving that
 * axis crosses the surface exactly once and "in gamut" is one interval from 0.
 *
 * Callers use it to END a chroma slider's track. Letting the track run to a
 * fixed 0.4 instead means the last third of the drag does nothing visible and
 * the per-channel clamp quietly shifts the hue while it happens.
 */
export function srgbChromaCeiling(l: number, h: number): number {
  if (!inSrgbGamut(l, 0, h)) return 0;
  let lo = 0;
  let hi = 0.4; // CSS's own 100% for oklch chroma; nothing in sRGB comes near.
  if (inSrgbGamut(l, hi, h)) return hi;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut(l, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Whether this OKLCh triple has an sRGB colour, before any clamping.
 *
 * The epsilon absorbs float noise and NOTHING else — it is deliberately far
 * below one 8-bit step rather than set to it. Near `L = 0` the OKLab cube
 * crushes all three linear channels toward zero, so an epsilon loose enough to
 * look like a display tolerance (1e-6) reads a chroma of 0.014 as
 * representable at pure black, and the ceiling stops being a ceiling exactly
 * where the picker's grey slots live.
 */
export function inSrgbGamut(l: number, c: number, h: number): boolean {
  const { r, g, b } = oklchToLinearSrgb(l, c, h);
  const eps = 1e-9;
  return (
    r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps
  );
}

function parseHex(s: string): Rgba | null {
  const h = s.slice(1);
  const ok = /^[0-9a-fA-F]+$/.test(h);
  if (!ok) return null;
  const dup = (c: string) => Number.parseInt(c + c, 16);
  const pair = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
  if (h.length === 3 || h.length === 4) {
    return {
      r: dup(h[0]),
      g: dup(h[1]),
      b: dup(h[2]),
      a: h.length === 4 ? dup(h[3]) / 255 : 1,
    };
  }
  if (h.length === 6 || h.length === 8) {
    return {
      r: pair(0),
      g: pair(2),
      b: pair(4),
      a: h.length === 8 ? pair(6) / 255 : 1,
    };
  }
  return null;
}

/**
 * Split a functional colour's argument list into components and an optional
 * alpha, accepting both the legacy comma form and the modern space form with a
 * `/` before alpha. `rgb(1,2,3)`, `rgb(1 2 3 / 50%)` and `rgba(1,2,3,0.5)` all
 * land in the same shape.
 */
function args(body: string): { parts: string[]; alpha: string | null } | null {
  const slash = body.split("/");
  if (slash.length > 2) return null;
  const alpha = slash.length === 2 ? slash[1] : null;
  const head = slash[0].trim();
  const parts = head.includes(",")
    ? head.split(",").map((p) => p.trim())
    : head.split(/\s+/).filter(Boolean);
  // The legacy comma form puts alpha in the list rather than after a slash.
  if (alpha === null && parts.length === 4) {
    return { parts: parts.slice(0, 3), alpha: parts[3] };
  }
  if (parts.length !== 3) return null;
  return { parts, alpha };
}

/**
 * Parse a CSS colour into sRGB bytes, or null when the syntax is not one this
 * understands.
 *
 * Null is a real answer, not a failure to report: the caller substitutes a
 * mode-calibrated fallback. Handing the unparsed string onward is exactly the
 * silent-no-op this module exists to prevent.
 */
export function parseCssColor(value: string | null | undefined): Rgba | null {
  if (!value) return null;
  const s = value.trim().toLowerCase();
  if (s.length === 0) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith("#")) return parseHex(s);

  const fn = /^([a-z]+)\((.*)\)$/s.exec(s);
  if (!fn) return null;
  const [, name, body] = fn;
  const a = args(body);
  if (!a) return null;

  const alpha = a.alpha === null ? 1 : scalar(a.alpha, 1);
  if (!Number.isFinite(alpha)) return null;

  if (name === "rgb" || name === "rgba") {
    // Percentages are relative to 255 here, unlike alpha.
    const ch = a.parts.map((p) => (p.endsWith("%") ? scalar(p, 255) : scalar(p, 1)));
    if (ch.some((n) => !Number.isFinite(n))) return null;
    return {
      r: byte(ch[0] / 255),
      g: byte(ch[1] / 255),
      b: byte(ch[2] / 255),
      a: clamp01(alpha),
    };
  }

  if (name === "oklch") {
    const L = scalar(a.parts[0], 1);
    const C = scalar(a.parts[1], 0.4); // CSS defines 100% chroma as 0.4 for oklch
    const H = a.parts[2] === "none" ? 0 : Number.parseFloat(a.parts[2]);
    if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;
    return { ...oklchToRgb(clamp01(L), Math.max(0, C), H), a: clamp01(alpha) };
  }

  return null;
}

/**
 * A canvas-safe string. `alpha` MULTIPLIES the colour's own alpha, so a token
 * that is already translucent stays so when a caller dims it further.
 */
export function rgbaCss(c: Rgba, alpha = 1): string {
  const a = clamp01(c.a * alpha);
  if (a >= 1) return `rgb(${c.r}, ${c.g}, ${c.b})`;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(a.toFixed(4))})`;
}
