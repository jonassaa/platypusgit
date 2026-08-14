import React from "react";
import { useDensityStep } from "@/features/settings/useSettingsStore";

/**
 * Used when --diff-row-h cannot be resolved to px — notably jsdom, which does not
 * evaluate calc(). A fallback, never the source of truth: CSS owns the real value,
 * and returning NaN here would collapse every windowed row to zero height.
 */
export const DIFF_ROW_H_FALLBACK = 19;

export function readDiffRowHeight(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--diff-row-h")
    .trim();
  const n = Number.parseFloat(raw);
  return raw.endsWith("px") && Number.isFinite(n) && n > 0 ? n : DIFF_ROW_H_FALLBACK;
}

/**
 * Code-row pitch in px, read from CSS rather than restated here.
 *
 * --lh-code stays the owner of code geometry, and 1.55 × 12px is 18.6px — any
 * literal in TypeScript would already be wrong and would desync the window from
 * the rows it is measuring (the #70 lesson).
 *
 * Re-read when density changes, because that is when the theme layer rewrites
 * geometry-adjacent tokens.
 */
export function useDiffRowHeight(): number {
  const step = useDensityStep();
  const [h, setH] = React.useState(() => readDiffRowHeight());
  React.useEffect(() => {
    setH(readDiffRowHeight());
  }, [step]);
  return h;
}
