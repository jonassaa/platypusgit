// ─── HEAD ("you are here") row treatment ─────────────────────────────────────
//
// Replaces the old `headIndicator` enum (none | bar | tint | both). That shape
// had two problems the user hit directly: every COMBINATION needed its own
// label, so the list read as jargon rather than choices, and there was no way
// to ask for a *heavier* version of a mark you already had — the wash was
// pinned at 0.16 alpha and the bar at 3px.
//
// So: independent MARKS (pick any subset) × one WEIGHT knob that scales all of
// them together. Adding a mark is one entry in three records here plus one
// branch in the renderer; it never multiplies the option list.

/**
 * One visual mark on the HEAD row, independent of the others.
 *
 * `ring` is the graph's own HEAD circle. It is a mark like the rest so it can
 * be turned OFF too — it used to be unconditional, which meant "no indicator"
 * was not actually reachable.
 */
export const HEAD_MARKS = [
  "bar",
  "tint",
  "outline",
  "badge",
  "bold",
  "ring",
] as const;
export type HeadMark = (typeof HEAD_MARKS)[number];

export const HEAD_MARK_LABELS: Record<HeadMark, string> = {
  bar: "Edge bar",
  tint: "Row highlight",
  outline: "Full outline",
  badge: "HEAD badge",
  bold: "Bold subject",
  ring: "Graph ring",
};

export const HEAD_MARK_HINTS: Record<HeadMark, string> = {
  bar: "Accent bar down the row's left edge.",
  tint: "Washes the whole row in the accent color.",
  outline: "Accent ring around the row. Still shows on the selected row, where the wash gives way.",
  badge: "An accent HEAD pill beside the branch pills — names the state in words.",
  bold: "Bolds the commit subject.",
  ring: "The circle around HEAD's dot in the graph column.",
};

/** How hard every chosen mark hits. One knob, not a slider per mark. */
export const HEAD_WEIGHTS = ["subtle", "strong", "intense"] as const;
export type HeadWeight = (typeof HEAD_WEIGHTS)[number];

export const HEAD_WEIGHT_LABELS: Record<HeadWeight, string> = {
  subtle: "Subtle",
  strong: "Strong",
  intense: "Intense",
};

export const HEAD_WEIGHT_HINTS: Record<HeadWeight, string> = {
  subtle: "About as loud as a hover — what the app shipped with.",
  strong: "Roughly twice that. The default.",
  intense: "As heavy as the row can go while its text stays readable.",
};

export const DEFAULT_HEAD_WEIGHT: HeadWeight = "strong";

/**
 * Marks + weight resolved to the numbers a renderer needs.
 *
 * Every dimension uses **zero for "don't draw"**, so a row component never
 * consults the mark list — which is what keeps this decision in one place and
 * lets `React.memo` compare a single stable object instead of an array.
 */
export interface HeadDecor {
  /** Left edge bar width in px. */
  barW: number;
  /** Blur radius of the bar's glow, in px. */
  barGlow: number;
  /** Alpha of the full-row accent wash. */
  tintAlpha: number;
  /** Inset outline width in px. */
  outlineW: number;
  /** Alpha of that outline. */
  outlineAlpha: number;
  /** Draw the "HEAD" pill. */
  badge: boolean;
  /** Blur radius of the pill's glow, in px. */
  badgeGlow: number;
  /** Font weight for the commit subject; 0 means "inherit". */
  subjectWeight: number;
  /** Stroke width of the graph's HEAD ring, in SVG user units. */
  ringStroke: number;
  /**
   * Width of the translucent halo drawn under that ring. A second circle
   * rather than a CSS `filter` — the graph is SVG inside a virtualized list,
   * and a per-row filter is the expensive way to draw a glow.
   */
  ringGlow: number;
  /** No mark at all is on. Lets callers skip the whole treatment. */
  bare: boolean;
}

interface WeightSpec {
  barW: number;
  barGlow: number;
  tintAlpha: number;
  outlineW: number;
  outlineAlpha: number;
  badgeGlow: number;
  subjectWeight: number;
  ringStroke: number;
  ringGlow: number;
}

// `tintAlpha` stays under 0.5 at every weight on purpose: past roughly half,
// an accent wash starts to fight the row's own foreground tokens and the sha /
// author columns stop reading. "Intense" is the ceiling, not an invitation.
const WEIGHTS: Record<HeadWeight, WeightSpec> = {
  subtle: {
    barW: 3,
    barGlow: 4,
    tintAlpha: 0.14,
    outlineW: 1,
    outlineAlpha: 0.45,
    badgeGlow: 0,
    subjectWeight: 500,
    ringStroke: 1,
    ringGlow: 0,
  },
  strong: {
    barW: 5,
    barGlow: 8,
    tintAlpha: 0.28,
    outlineW: 1,
    outlineAlpha: 0.85,
    badgeGlow: 4,
    subjectWeight: 600,
    ringStroke: 1.6,
    ringGlow: 2,
  },
  intense: {
    barW: 8,
    barGlow: 14,
    tintAlpha: 0.44,
    outlineW: 2,
    outlineAlpha: 1,
    badgeGlow: 8,
    subjectWeight: 700,
    ringStroke: 2.2,
    ringGlow: 4,
  },
};

export const NO_HEAD_DECOR: HeadDecor = {
  barW: 0,
  barGlow: 0,
  tintAlpha: 0,
  outlineW: 0,
  outlineAlpha: 0,
  badge: false,
  badgeGlow: 0,
  subjectWeight: 0,
  ringStroke: 0,
  ringGlow: 0,
  bare: true,
};

/** Resolve the user's choices into draw numbers. Pure — safe to memoize. */
export function resolveHeadDecor(
  marks: readonly HeadMark[],
  weight: HeadWeight,
): HeadDecor {
  const w = WEIGHTS[weight] ?? WEIGHTS[DEFAULT_HEAD_WEIGHT];
  const on = (m: HeadMark) => marks.includes(m);
  return {
    barW: on("bar") ? w.barW : 0,
    barGlow: on("bar") ? w.barGlow : 0,
    tintAlpha: on("tint") ? w.tintAlpha : 0,
    outlineW: on("outline") ? w.outlineW : 0,
    outlineAlpha: on("outline") ? w.outlineAlpha : 0,
    badge: on("badge"),
    badgeGlow: on("badge") ? w.badgeGlow : 0,
    subjectWeight: on("bold") ? w.subjectWeight : 0,
    ringStroke: on("ring") ? w.ringStroke : 0,
    ringGlow: on("ring") ? w.ringGlow : 0,
    bare: !HEAD_MARKS.some(on),
  };
}

/**
 * Sanitize a persisted / hand-edited mark list. Returns `null` when the value
 * is not a list at all, so the caller can tell "absent" (use the default) from
 * "the user turned everything off" — an empty array is a legitimate choice.
 */
export function normalizeHeadMarks(value: unknown): HeadMark[] | null {
  if (!Array.isArray(value)) return null;
  const wanted = new Set(value.filter((v): v is string => typeof v === "string"));
  // Filtered through the catalog rather than the input, so the result is always
  // deduped AND in a stable order — otherwise the persisted JSON churns on
  // every toggle and a settings diff is unreadable.
  return HEAD_MARKS.filter((m) => wanted.has(m));
}

const LEGACY: Record<string, HeadMark[]> = {
  none: ["ring"],
  bar: ["bar", "ring"],
  tint: ["tint", "ring"],
  both: ["bar", "tint", "ring"],
};

/**
 * Map an old `headIndicator` value onto marks. `ring` is added to all four
 * because the graph ring was unconditional back then — including under "none",
 * whose label was literally "Graph marker only".
 *
 * `null` for anything unrecognised, so the caller falls through to the default.
 */
export function migrateHeadIndicator(legacy: unknown): HeadMark[] | null {
  return typeof legacy === "string" ? (LEGACY[legacy] ?? null) : null;
}
