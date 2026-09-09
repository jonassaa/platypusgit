import type { ThemeColors, ThemeDef } from "@/features/settings/useSettingsStore";

import { normalizeHex } from "./ColorEditor";
import { contrastRatio } from "./contrast";

/**
 * The guided start: a base theme plus an accent.
 *
 * Deliberately NOT a palette generator. Forking a built-in theme and then
 * hunting for the one slot that makes a button look right is the current
 * two-minute task; swapping the accent and fixing the ink is the two-click
 * version of it. Hue-shifting the greys as well would produce palettes the
 * user can neither predict nor correct, and every one of the 18 slots stays
 * editable underneath — so cleverness here buys nothing and costs
 * predictability.
 *
 * `accentInk` is the one slot that CANNOT be left to the user: it is the text
 * drawn on the accent, so a bright accent with the base's dark ink is fine and
 * a bright accent with the base's light ink is an unreadable button.
 */

/** WCAG AA for large text / UI, the bar a button label has to clear. */
const READABLE = 4.5;

/**
 * Pick the ink for `accent`, preferring the base theme's own extremes.
 *
 * Staying in the base's family is the point: jumping to pure black or pure
 * white on every derive would make every custom theme's buttons look the same.
 * The pure extremes are the fallback for a mid-tone accent, where neither of
 * the base's own inks clears the bar.
 */
function inkFor(base: ThemeColors, accent: string): string {
  const candidates = [base.fg0, base.bg0, "#ffffff", "#000000"];
  const readable = candidates.find((ink) => contrastRatio(ink, accent) >= READABLE);
  if (readable) return readable;
  // Nothing clears AA — take whatever reads best rather than refusing. The
  // editor's contrast warning is what tells the user; this never blocks.
  return candidates.reduce((best, ink) =>
    contrastRatio(ink, accent) > contrastRatio(best, accent) ? ink : best,
  );
}

export function deriveTheme(base: ThemeDef, accent: string): ThemeColors {
  const norm = normalizeHex(accent);
  if (!norm) return { ...base.colors };
  return { ...base.colors, accent: norm, accentInk: inkFor(base.colors, norm) };
}
