import type { ThemeColors } from "@/features/settings/useSettingsStore";

import { normalizeHex } from "./ColorEditor";

/**
 * WCAG contrast, for the four pairs that decide whether the app is readable.
 *
 * The editor let you build a theme with white text on a white canvas and said
 * nothing. That is the worst thing about it: a colour picker with no feedback
 * is a colour picker that lets you break your own app and then wonder why.
 *
 * So the editor warns — and only warns. A deliberately low-contrast theme is
 * the user's own choice, Save is never disabled by a finding, and nothing here
 * refuses a colour.
 */

/** sRGB channel → linear, per WCAG 2.x relative luminance. */
function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number | null {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio between two hex colours, 1 to 21. Returns `NaN` when either
 * side cannot be parsed — a half-typed hex is not a finding.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return NaN;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastLevel = "ok" | "low" | "bad";

export type ContrastFinding = {
  a: keyof ThemeColors;
  b: keyof ThemeColors;
  /** User-facing prose. A user never reads a colour-slot key. */
  what: string;
  ratio: number;
  level: ContrastLevel;
};

/**
 * The pairs worth checking. Not every combination — a report with twenty
 * findings is a report nobody reads. These four are the ones that make the app
 * unusable when they fail.
 */
export const CONTRAST_PAIRS: {
  a: keyof ThemeColors;
  b: keyof ThemeColors;
  what: string;
}[] = [
  { a: "fg0", b: "bg0", what: "Primary text on the app canvas" },
  { a: "fg1", b: "bg1", what: "Secondary text on a panel" },
  { a: "fg2", b: "bg1", what: "Muted text on a panel" },
  { a: "accentInk", b: "accent", what: "Button text on the accent" },
];

/** WCAG AA for body text. Below this, warn. */
const AA_TEXT = 4.5;
/** WCAG AA for large text and UI. Below this, warn harder. */
const AA_LARGE = 3;

function level(ratio: number): ContrastLevel {
  if (ratio < AA_LARGE) return "bad";
  if (ratio < AA_TEXT) return "low";
  return "ok";
}

/** Every pair that falls short, worst first. Empty when the theme is fine. */
export function contrastReport(colors: ThemeColors): ContrastFinding[] {
  return CONTRAST_PAIRS.map(({ a, b, what }) => {
    const ratio = contrastRatio(colors[a] ?? "", colors[b] ?? "");
    return { a, b, what, ratio, level: level(ratio) };
  })
    .filter((f) => Number.isFinite(f.ratio) && f.level !== "ok")
    .sort((x, y) => x.ratio - y.ratio);
}
