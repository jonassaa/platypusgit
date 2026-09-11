import type { ThemeColors, ThemeDef } from "@/features/settings/useSettingsStore";

import { hexToRgb, normalizeHex, rgbToHex } from "@/lib/color";
import { oklchToRgb, rgbToOklch, srgbChromaCeiling } from "@/lib/cssColor";

import { inkFor } from "./deriveTheme";

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
  const amount = clamp01(strength);
  // Tint 0 means the surfaces are left alone — not "rotated to the ground hue
  // but no extra chroma". Without this the identity holds only when the ground
  // hue happens to equal the base's own family hue, which it almost never does:
  // the ground is `seed + rule.ground`, a quantised angle, while a base's real
  // offset is whatever it is (dark-cool's is 18.6 degrees, and no rule has
  // that). Rotating a ramp that still carries its own chroma changes every
  // slot, so opening the editor would silently move `bg0` from #1a1d24 to
  // #1b1d24 before the user touched anything. The cost is a step at the very
  // bottom of the slider, which defaults to 0.35 and is never sat on.
  if (amount === 0) return { ...colors };

  const family = familyHue(colors);
  const delta = family === null ? 0 : groundHue - family;
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

export type HarmonyRule =
  | "mono"
  | "analogous"
  | "triadic"
  | "split"
  | "complementary";

/**
 * How far the ground and the two logo colours sit from the seed.
 *
 * The ground takes the rule's angle. `logo` and `logo2` sit on opposite sides of
 * the seed wherever the rule allows, so the mark always carries two
 * distinguishable colours — Monochrome and Complementary are nudged off the
 * literal mirror, because the mirror of 0 is 0 and the mirror of 180 is 180, and
 * either would collapse the pair.
 *
 * Analogous is the default because it is what the built-ins do. Measured, every
 * one of the nine places its surface hue within 46 degrees of its accent — five
 * within 20 — and not one is complementary or triadic. The wide angles stay on
 * offer because exploring past the built-ins is the point of the feature, but
 * they are the adventurous setting rather than the one you get for free.
 */
export const HARMONY_RULES = [
  { id: "mono", label: "Monochrome", ground: 0, logo: -30, logo2: 30 },
  { id: "analogous", label: "Analogous", ground: 30, logo: -30, logo2: 60 },
  { id: "triadic", label: "Triadic", ground: 120, logo: 120, logo2: -120 },
  { id: "split", label: "Split-complement", ground: 150, logo: 150, logo2: -150 },
  { id: "complementary", label: "Complementary", ground: 180, logo: 180, logo2: -60 },
] as const satisfies readonly {
  id: HarmonyRule;
  label: string;
  ground: number;
  logo: number;
  logo2: number;
}[];

export const DEFAULT_TRAIT_RULE: HarmonyRule = "analogous";
export const DEFAULT_TRAIT_STRENGTH = 0.35;

export function harmonyOffsets(rule: HarmonyRule) {
  return HARMONY_RULES.find((r) => r.id === rule) ?? HARMONY_RULES[1];
}

/** The four values a generated palette is a pure function of. */
export type PaletteTraits = {
  /** Which theme supplies the lightness ramp and its baseline chroma. */
  baseId: string;
  /** One colour. Becomes `accent` verbatim. */
  seed: string;
  rule: HarmonyRule;
  /** 0 to 1. 0 is the identity. */
  strength: number;
};

/** Keep a slot's lightness and chroma, move it to `hue`. */
function rotateTo(hex: string, hue: number): string {
  const o = oklchOf(hex);
  if (!o) return hex;
  const h = norm360(hue);
  return rgbToHex(oklchToRgb(o.l, Math.min(o.c, srgbChromaCeiling(o.l, h)), h));
}

/**
 * The whole palette, from four values.
 *
 * `accent` is the seed verbatim and is never tinted — it is the one colour the
 * user chose outright, and rewriting it would make the swatch lie. `accentInk`
 * goes through `deriveTheme`'s `inkFor`, so there is still exactly one rule in
 * this tree about what can be read on a button.
 */
export function generate(base: ThemeDef, traits: PaletteTraits): ThemeColors {
  const seed = normalizeHex(traits.seed);
  const o = seed ? oklchOf(seed) : null;
  // A half-typed hex is not a palette. Hand back the base rather than
  // generating from noise — the editor's own field keeps the user's text.
  if (!seed || !o) return { ...base.colors };

  const off = harmonyOffsets(traits.rule);
  const amount = clamp01(traits.strength);
  const colors = tintRamp(base.colors, norm360(o.h + off.ground), amount);
  colors.accent = seed;
  colors.accentInk = inkFor(colors, seed);
  // The logo pair is a surface like the ramp, so tint 0 leaves it alone too.
  // That makes tint the one master control — at 0 this function degenerates
  // EXACTLY to `deriveTheme`, the accent swap that shipped before it, and at 1
  // it is a fully generated palette. Without the gate, opening any built-in
  // read as "Custom" immediately, because a rule places the logo pair at
  // angles the theme's own mark was never drawn at.
  if (amount > 0) {
    colors.logo = rotateTo(base.colors.logo, o.h + off.logo);
    colors.logo2 = rotateTo(base.colors.logo2, o.h + off.logo2);
  }
  return colors;
}

export type TraitLocks = {
  base: boolean;
  seed: boolean;
  rule: boolean;
  strength: boolean;
};

export const NO_LOCKS: TraitLocks = {
  base: false,
  seed: false,
  rule: false,
  strength: false,
};

/** An angle folded into [-180, 180), so 350 and -10 are the same distance. */
function signed180(deg: number): number {
  return (((deg % 360) + 540) % 360) - 180;
}

/** How near a measured angle has to be before a rule claims it. */
const RULE_TOLERANCE = 15;

/**
 * The traits that regenerate this theme, read back out of its own palette.
 *
 * There is no persisted trait format on purpose: the moment traits are stored, a
 * theme has two sources of truth and every importer has to decide which wins.
 * Reading them back works because strength 0 leaves the ramp alone — base is the
 * theme itself, so opening any theme for edit regenerates its surfaces
 * byte-for-byte and nothing moves until the user moves something.
 */
export function inferTraits(theme: ThemeDef): PaletteTraits {
  const family = familyHue(theme.colors);
  const accent = oklchOf(theme.colors.accent);
  let rule: HarmonyRule = DEFAULT_TRAIT_RULE;
  if (family !== null && accent) {
    // MAGNITUDE, not the signed angle: a rule's offsets are written one way
    // round (+30) but a theme is equally analogous 30 degrees the other way.
    // Measured, dracula sits at -29.0 and solarized-dark at -30.1, and matching
    // on the signed value would name neither.
    const delta = Math.abs(signed180(family - accent.h));
    const near = HARMONY_RULES.find((r) => Math.abs(delta - r.ground) <= RULE_TOLERANCE);
    if (near) rule = near.id;
  }
  return { baseId: theme.id, seed: theme.colors.accent, rule, strength: 0 };
}

/**
 * Whether this palette is still exactly what the traits produce.
 *
 * False the moment a slot is hand-edited, which is what flips the editor's
 * harmony readout to "Custom". Hand editing is never blocked — a generated slot
 * is a plain hex string like every other, and the next trait change regenerates
 * over it, which is what Revert is for.
 */
export function isGenerated(
  colors: ThemeColors,
  base: ThemeDef,
  traits: PaletteTraits,
): boolean {
  const want = generate(base, traits);
  return (Object.keys(want) as (keyof ThemeColors)[]).every(
    // `accentInk` is excluded because it is a CONSEQUENCE, not a choice. The
    // built-ins ship hand-authored inks that predate the generator — dark-cool
    // carries #0e1a26 where `inkFor` picks #1a1d24 off its own ramp — so
    // comparing it would make every built-in read as "Custom" the moment it was
    // opened, which is the opposite of what the readout is for.
    (key) => key === "accentInk" || want[key] === colors[key],
  );
}

/** The measured span of the nine built-in accents: L 0.518-0.775, C 0.062-0.191. */
const SEED_L: [number, number] = [0.52, 0.78];
const SEED_C: [number, number] = [0.06, 0.19];
/** Never 0: a dice press that changes nothing visible reads as a broken button. */
const ROLL_STRENGTH: [number, number] = [0.15, 0.7];

/**
 * Monochrome and Analogous at twice the weight of the rest.
 *
 * Not arbitrary: all nine built-ins sit in those two bands, so the near angles
 * are what reads as a designed theme and the dice should land there more often.
 */
const ROLL_RULES: readonly HarmonyRule[] = [
  "mono",
  "mono",
  "analogous",
  "analogous",
  "triadic",
  "split",
  "complementary",
];

/**
 * Re-roll every unlocked trait.
 *
 * It cannot produce an unusable theme, because the four traits are the only
 * inputs and each rolls inside a measured band — the ramp still comes from a
 * calibrated built-in, and `tintRamp` cannot move a contrast verdict.
 *
 * `rand` is injected so a test can script a roll. Every trait draws in a fixed
 * order whether or not it is locked, so a scripted sequence lines up the same
 * way regardless of which locks are set.
 */
export function rollTraits(
  current: PaletteTraits,
  locks: TraitLocks,
  mode: "dark" | "light",
  pool: readonly ThemeDef[],
  rand: () => number = Math.random,
): PaletteTraits {
  const between = ([lo, hi]: [number, number]) => lo + rand() * (hi - lo);

  const bases = pool.filter((t) => t.builtin && t.mode === mode);
  const baseRoll = rand();
  const seedH = rand() * 360;
  const seedL = between(SEED_L);
  const seedC = Math.min(between(SEED_C), srgbChromaCeiling(seedL, seedH));
  const ruleRoll = rand();
  const strength = between(ROLL_STRENGTH);

  const pick = <T,>(xs: readonly T[], roll: number) =>
    xs[Math.min(xs.length - 1, Math.floor(roll * xs.length))];

  return {
    baseId:
      locks.base || bases.length === 0 ? current.baseId : pick(bases, baseRoll).id,
    seed: locks.seed ? current.seed : rgbToHex(oklchToRgb(seedL, seedC, seedH)),
    rule: locks.rule ? current.rule : pick(ROLL_RULES, ruleRoll),
    strength: locks.strength ? current.strength : strength,
  };
}
