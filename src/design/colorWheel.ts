// Where things are on a colour wheel and along a slider — PURE arithmetic, no
// React and no DOM, for the reason `selectPos.ts` and `paneSize.ts` give: jsdom
// performs no layout, so a component test measures a rendered wheel as 0×0 and
// could only ever assert about zeroes.
//
// Conventions, both of them invisible in code and glaring on screen:
//
//   * Hue 0 is at the RIGHT and increases COUNTER-CLOCKWISE. Mirror it and
//     every round-trip test still passes while the wheel reads backwards.
//   * Coordinates are offsets from the wheel's CENTRE, in CSS pixels, with +y
//     pointing DOWN the way the DOM does. Callers subtract the centre before
//     asking and add it back before drawing.

import { hsvToRgb } from "@/lib/color";

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const DEG = 180 / Math.PI;

/** Where the cursor for this hue and saturation sits, relative to the centre. */
export function wheelPoint(h: number, s: number, radius: number): { x: number; y: number } {
  const a = h / DEG;
  const r = clamp(s, 0, 1) * radius;
  // `+ 0` folds away the negative zeroes trigonometry leaves at the axes
  // (`Math.cos(Math.PI) * 0` is `-0`). Nothing renders differently, but it
  // keeps "zero saturation is exactly the centre" true as an equality rather
  // than only as an approximation.
  return { x: Math.cos(a) * r + 0, y: -Math.sin(a) * r + 0 };
}

/**
 * How far past the rim still counts as on it.
 *
 * `wheelPoint(h, 1, r)` comes back at `r + 1e-14` for most angles, so a strict
 * `dist > radius` refuses the fully-saturated rim it just produced — the wheel
 * would go dead in a one-float-wide ring exactly where the pure colours are.
 */
const RIM_EPS = 1e-9;

/** The hue and saturation a point names, or null when it is off the disc. */
export function wheelHueSat(
  x: number,
  y: number,
  radius: number,
): { h: number; s: number } | null {
  const dist = Math.hypot(x, y);
  if (dist > radius + RIM_EPS) return null;
  return { h: angleOf(x, y), s: radius === 0 ? 0 : Math.min(1, dist / radius) };
}

/**
 * The same, but a point outside the disc is pinned to the rim rather than
 * refused.
 *
 * This is the one a DRAG uses. A pointer that slips off the wheel mid-gesture
 * must keep picking the hue it is pointing at — stopping dead at the rim, or
 * worse reading the miss as "no colour", is what makes a wheel feel broken
 * exactly when someone is trying to reach full saturation.
 */
export function wheelHueSatClamped(
  x: number,
  y: number,
  radius: number,
): { h: number; s: number } {
  const dist = Math.hypot(x, y);
  return {
    h: angleOf(x, y),
    s: radius === 0 ? 0 : Math.min(1, dist / radius),
  };
}

/** Screen-space offset → hue degrees in `[0, 360)`. The centre answers 0. */
function angleOf(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  const deg = Math.atan2(-y, x) * DEG;
  return deg < 0 ? deg + 360 : deg;
}

/** How wide the rim's alpha ramp is, in pixels. */
const FEATHER = 1.2;

/**
 * Paint the wheel at FULL VALUE into an RGBA buffer of `size`×`size`.
 *
 * Full value only, and that is the whole performance story. HSV's value scales
 * all three channels linearly, so `hsv(h, s, v)` is exactly `hsv(h, s, 1)`
 * composited under black at alpha `1 - v` — which means the value slider costs
 * one composite of an already-painted bitmap instead of re-running this loop.
 * At the sizes a popover uses that is the difference between a wheel that
 * tracks the pointer and one that hitches on every frame.
 *
 * The rim gets an alpha ramp rather than a hard cut: at 170-odd pixels across,
 * an aliased edge reads as a cog, not a circle.
 */
export function paintWheelRgba(data: Uint8ClampedArray, size: number): void {
  const radius = size / 2;
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) {
        data[i + 3] = 0;
        continue;
      }
      const { r, g, b } = hsvToRgb({
        h: angleOf(dx, dy),
        s: Math.min(1, dist / radius),
        v: 1,
      });
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(255 * clamp((radius - dist) / FEATHER, 0, 1));
    }
  }
}

/** The value a pointer `pos` pixels along a `length`-pixel track picks. */
export function sliderValue(
  pos: number,
  length: number,
  min: number,
  max: number,
): number {
  if (length <= 0) return min;
  return min + (max - min) * clamp(pos / length, 0, 1);
}

/** Where a value's handle belongs along its track, 0 to 1. */
export function sliderFraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}
