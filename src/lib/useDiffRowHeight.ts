import React from "react";
import { useSpacingStep, useTextScale } from "@/features/settings/useSettingsStore";

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
 * Re-read when either UI scale changes. The TEXT scale is the one that
 * actually moves this value — `--diff-row-h` is derived from `--fs-12` —
 * spacing never touches it. The spacing dependency is kept anyway as cheap
 * insurance: re-reading a CSS var costs nothing next to the render it is
 * already part of, and it means this hook does not need to be revisited if
 * `--diff-row-h`'s formula ever grows a `--row-step` term. (It is NOT because
 * `applyTheme` rewrites geometry tokens — it writes colour only, per
 * `useSettingsStore.ts`'s `applyTheme`.)
 */
export function useDiffRowHeight(): number {
  const step = useSpacingStep();
  const scale = useTextScale();
  const [h, setH] = React.useState(() => readDiffRowHeight());
  React.useEffect(() => {
    setH(readDiffRowHeight());
  }, [step, scale]);
  return h;
}
