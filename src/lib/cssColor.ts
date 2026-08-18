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

/**
 * OKLCh → sRGB, via OKLab and linear sRGB (Björn Ottosson's matrices).
 *
 * Out-of-gamut values are clamped per channel rather than gamut-mapped. Every
 * token this parses is already inside sRGB — they were authored against a
 * browser rendering them — so the clamp is a guard, not the normal path.
 */
function oklchToRgb(L: number, C: number, hDeg: number): { r: number; g: number; b: number } {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return { r: byte(gamma(rLin)), g: byte(gamma(gLin)), b: byte(gamma(bLin)) };
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
