import type { ThemeColors } from "@/features/settings/useSettingsStore";

import { hexToRgb, rgbToHex } from "@/lib/color";
import { oklchToRgb, rgbToOklch, srgbChromaCeiling } from "@/lib/cssColor";

/**
 * Palette generation, in OKLCh, as pure arithmetic.
 *
 * The 2026-09-09 spec ruled a palette generator out, and it was right to: in
 * HSL, hue and lightness are one knob, so a generated ramp's contrast lands
 * wherever it lands and the user can neither predict nor correct it. OKLCh
 * separates them. Everything here rewrites HUE and CHROMA while holding each
 * slot's LIGHTNESS exactly, which is what lets the base theme's hand-tuned ramp
 * — the part that takes longest to build by hand and that nobody has the
 * vocabulary to repair — survive generation intact.
 *
 * Two properties are pinned by `palette.test.ts` rather than by this comment:
 * strength 0 reproduces the base byte-for-byte, and no hue at any strength
 * moves a contrast pair across an AA boundary (measured 0 changes in 3240).
 *
 * `deriveTheme.ts` next door is NOT superseded. It is still the accent swap the
 * eighteen-slot path uses, and this module calls its `inkFor` rather than
 * growing a second rule about what is readable on a button.
 */

/**
 * The fourteen slots the ground tint rewrites.
 *
 * `accent` is a seed, `accentInk` is computed from it, and the two logo slots
 * are placed by the harmony rule — so none of the four belongs here.
 */
export const RAMP_SLOTS = [
  "bg0",
  "bg1",
  "bg2",
  "bg3",
  "bg4",
  "titlebar",
  "fg0",
  "fg1",
  "fg2",
  "fg3",
  "fg4",
  "border0",
  "border1",
  "border2",
] as const satisfies readonly (keyof ThemeColors)[];

/**
 * Below this chroma a slot is grey, and the hue `rgbToOklch` reports for it is
 * numerical noise rather than a colour. Averaging that noise into the family
 * hue is how a neutral ramp acquires an arbitrary tint.
 */
const CHROMA_FLOOR = 0.004;

/** Chroma added on top of a slot's own at strength 1. */
const TINT_REACH = 0.06;

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function oklchOf(hex: string) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToOklch(rgb) : null;
}

/**
 * The hue this ramp reads as: the CHROMA-WEIGHTED circular mean over the slots
 * that carry any colour at all.
 *
 * Weighted, not plain, because the slots differ by an order of magnitude —
 * solarized-dark's `bg4` carries chroma 0.066 against its `fg2`'s 0.016 — and
 * the strongly tinted slots are the ones that decide what family a theme reads
 * as. Circular, not arithmetic, because hue wraps and a plain mean of 350 and
 * 10 is 180: the exact opposite of both.
 *
 * `null` when no slot clears the floor. Of the nine built-ins that is
 * `dark-neutral` alone.
 */
export function familyHue(colors: ThemeColors): number | null {
  let x = 0;
  let y = 0;
  for (const key of RAMP_SLOTS) {
    const o = oklchOf(colors[key]);
    if (!o || o.c < CHROMA_FLOOR) continue;
    const rad = (o.h * Math.PI) / 180;
    x += Math.cos(rad) * o.c;
    y += Math.sin(rad) * o.c;
  }
  if (x === 0 && y === 0) return null;
  return norm360((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * Move the ramp to `groundHue`, holding every slot's lightness.
 *
 * The hue is applied as a ROTATION by `groundHue - familyHue`, not as an
 * assignment. Five of the nine built-ins run one hue across the whole ramp, so
 * for those the two are the same thing — but dracula puts its text 171 degrees
 * from its backgrounds, solarized-dark 130, gruvbox-dark 170, all three on
 * purpose. Assigning one absolute hue flattens that and throws away what makes
 * those themes look like themselves.
 *
 * The chroma is ADDITIVE over the slot's own, because a multiplier cannot tint
 * an achromatic ramp: `dark-neutral` is chroma 0 in all fourteen slots and any
 * multiple of zero is zero. The `srgbChromaCeiling` clamp is the normal path
 * near the ends of the ramp, not an edge case — at `fg0`'s L of 0.957 the
 * ceiling is 0.024 at hue 300 against 0.141 at hue 120 — and skipping it means
 * a per-channel clip that shifts the hue silently.
 */
export function tintRamp(
  colors: ThemeColors,
  groundHue: number,
  strength: number,
): ThemeColors {
  const family = familyHue(colors);
  const delta = family === null ? 0 : groundHue - family;
  const amount = clamp01(strength);
  const out = { ...colors };
  for (const key of RAMP_SLOTS) {
    const o = oklchOf(colors[key]);
    if (!o) continue;
    const h = norm360(family === null ? groundHue : o.h + delta);
    const c = Math.min(o.c + amount * TINT_REACH, srgbChromaCeiling(o.l, h));
    out[key] = rgbToHex(oklchToRgb(o.l, c, h));
  }
  return out;
}
