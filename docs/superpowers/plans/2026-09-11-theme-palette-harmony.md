# Theme palette harmony + shuffle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the theme editor an Arc-style palette: four lockable traits (base
ramp, seed colour, harmony rule, tint strength) that generate all eighteen colour
slots, plus a dice that re-rolls the unlocked ones.

**Architecture:** One new pure module, `src/features/settings/theme/palette.ts`,
holding every piece of arithmetic. It rewrites hue and chroma in OKLCh while
holding each slot's lightness exactly, so the base theme's hand-tuned ramp and
its contrast survive generation. `useThemeEditorStore` gains the four traits and
their locks; `ThemeEditorDialog` replaces its "Start from" and "Accent" rows with
a Palette section. `deriveTheme.ts` is unchanged except for exporting `inkFor`.

**Tech Stack:** TypeScript, React 19, Zustand, vitest (jsdom for components, node
for doc guards), existing OKLCh helpers in `src/lib/cssColor.ts`.

**Spec:** `docs/superpowers/specs/2026-09-11-theme-palette-harmony-design.md`

## Global Constraints

Copied verbatim from the spec and from `CLAUDE.md`. Every task's requirements
implicitly include these.

- **Node 22 + pnpm.** Not npm, not yarn. The assistant's Bash tool does not
  inherit an interactive shell rc — invoke as `~/Library/pnpm/pnpm`.
- **This worktree has no `node_modules` until `pnpm install` has run.** Do that
  once before Task 1.
- **`@/` is the path alias for `src/`.** Use it for cross-feature imports; use
  relative paths inside `features/settings/theme/`, matching the files already
  there.
- **Lightness is held, never recomputed.** `o.l` from `rgbToOklch` goes straight
  back into `oklchToRgb`. This is what the contrast guarantee rests on.
- **Chroma is additive over the base's own and clamped to
  `srgbChromaCeiling(l, h)`.** Never a bare multiplier — a multiplier cannot tint
  an achromatic ramp, and an unclamped chroma gets per-channel clipped, which
  shifts the hue silently.
- **Hue is a rotation by `groundHue − familyHue`, never an assignment** — except
  when `familyHue` is `null`, where assignment is the only option and the slots
  are grey anyway.
- **`TINT_REACH = 0.06`**, **`CHROMA_FLOOR = 0.004`**, **harmony inference
  tolerance `±15°`**, **seed roll bands L `[0.52, 0.78]` / C `[0.06, 0.19]`**,
  **strength roll band `[0.15, 0.70]`**, **default rule `analogous` at strength
  `0.35`**.
- **Icons come from `PGIcon`.** `src/design/icons.tsx` is the ONLY file that may
  import `lucide-react`, and every icon name written as a string literal must be
  a member of `IconName`. `test/iconSet.test.ts` fails the build for both.
- **No native `<select>`/`<option>` and no `<input type="color">` in shipped
  `src/`.** Use `PGSelect` and `PGColorSwatch`. Guard tests enforce both.
- **Contrast advises, never blocks.** No Save is ever disabled by a finding.
- **Commit style:** `feat(scope): …` / `fix(scope): …` / `test: …` / `docs: …`,
  short imperative subject under 72 chars. End assistant-driven commits with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Never put a backtick in a `git commit -m` message** — the Bash tool evals the
  command and the backtick runs as a subshell that blocks forever. Use plain
  words, or `git commit -F <file>`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/features/settings/theme/palette.ts` | **New.** All palette arithmetic: family hue, ramp tinting, harmony offsets, generation, trait inference, trait rolling. Pure — no React, no DOM, no store. |
| `src/features/settings/theme/palette.test.ts` | **New.** The three measured guarantees, swept over all nine built-ins, plus roll bands and inference round-trip. |
| `src/design/icons.tsx` | Add `dice`, `lockOpen`, `palette` to the map and to `IconName`. |
| `src/design/color-picker.tsx` | Rename the private `Slider` to `PGSlider` and export it. |
| `src/features/settings/theme/deriveTheme.ts` | Export `inkFor` so the generator reuses the one ink rule. Nothing else changes. |
| `src/features/settings/theme/useThemeEditorStore.ts` | Four trait fields, four locks, `setTrait`, `toggleLock`, `shuffle`. `applyBase` becomes a trait write. |
| `src/features/settings/theme/ThemeEditorDialog.tsx` | The Palette section replaces the "Start from" and "Accent" rows. |
| `docs/dev/frontend.md` | The "deliberately not a palette generator" sentence is now wrong. |
| `docs/superpowers/specs/2026-09-09-theme-editor-revamp-spec.md` | Its non-goal gets a line pointing at the new spec. |

---

### Task 1: Expose the slider and add the three icons

The only changes to the design system. Reviewed on their own because they widen
a public surface that the rest of the app can then reach for.

**Files:**
- Modify: `src/design/color-picker.tsx` (the `Slider` function at ~line 622, and
  its two call sites in `ValueSlider` and `ChannelSlider`)
- Modify: `src/design/icons.tsx`
- Test: `test/iconSet.test.ts` (existing — must keep passing), and a new case in
  `src/design/color-picker.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PGSlider` exported from `@/design`, props
    `{ name: string; valueText: string; min: number; max: number; step: number; value: number; shownValue?: number; vertical?: boolean; trackCss: string; onChange: (next: number) => void }`
  - `IconName` gains the literals `"dice"`, `"lockOpen"`, `"palette"`.

- [ ] **Step 1: Write the failing test**

Append to `src/design/color-picker.test.tsx`:

```tsx
import { PGSlider } from "./color-picker";

describe("PGSlider", () => {
  it("is exported for reuse and reports the full slider value trio", () => {
    render(
      <PGSlider
        name="Tint"
        valueText="35%"
        min={0}
        max={1}
        step={0.01}
        value={0.35}
        trackCss="linear-gradient(90deg, #000, #fff)"
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Tint" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "1");
    expect(slider).toHaveAttribute("aria-valuenow", "0.35");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/design/color-picker.test.tsx -t "exported for reuse"`

Expected: FAIL — `PGSlider` is not exported from `./color-picker` (the function
is named `Slider` and is module-private).

- [ ] **Step 3: Write minimal implementation**

In `src/design/color-picker.tsx`, rename the function and export it:

```tsx
export function PGSlider({
  name,
  valueText,
  min,
  max,
  step,
  value,
  shownValue,
  vertical,
  trackCss,
  onChange,
}: {
```

Update its two call sites in the same file — `<Slider` becomes `<PGSlider` in
both `ValueSlider` and `ChannelSlider`. There are exactly two; grep to confirm:

```bash
grep -c "<Slider" src/design/color-picker.tsx   # expect 0 after the change
grep -c "<PGSlider" src/design/color-picker.tsx # expect 2 (3 counting the test file separately)
```

In `src/design/icons.tsx`, add the three lucide imports to the existing
alphabetical import block:

```tsx
  Dices,
  LockOpen,
  Palette,
```

Add the literals to the `IconName` union, on the line that already carries
`"lock"`:

```tsx
  | "download" | "upload" | "link" | "lock" | "lockOpen" | "dice" | "palette"
```

And the three map entries beside the existing `lock: Lock,`:

```tsx
  lockOpen: LockOpen,
  dice: Dices,
  palette: Palette,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
~/Library/pnpm/pnpm vitest run src/design/color-picker.test.tsx test/iconSet.test.ts
```

Expected: PASS. `iconSet.test.ts` matters as much as the new case — it is the
guard that fails the build if a lucide import escapes `icons.tsx` or a call-site
literal is not in the union.

- [ ] **Step 5: Commit**

```bash
git add src/design/color-picker.tsx src/design/icons.tsx src/design/color-picker.test.tsx
git commit -m "feat(design): export PGSlider and add dice, lockOpen, palette icons"
```

---

### Task 2: The ramp tint — `familyHue` and `tintRamp`

The core arithmetic, and the two measured guarantees that make reversing the old
non-goal defensible. Write the tests first and let them carry the real numbers —
they are the argument, not decoration.

**Files:**
- Create: `src/features/settings/theme/palette.ts`
- Test: `src/features/settings/theme/palette.test.ts`

**Interfaces:**
- Consumes: `ThemeColors` from `@/features/settings/useSettingsStore`;
  `hexToRgb`, `rgbToHex` from `@/lib/color`; `oklchToRgb`, `rgbToOklch`,
  `srgbChromaCeiling` from `@/lib/cssColor`.
- Produces:
  - `RAMP_SLOTS: readonly (keyof ThemeColors)[]` — the fourteen tinted slots.
  - `familyHue(colors: ThemeColors): number | null`
  - `tintRamp(colors: ThemeColors, groundHue: number, strength: number): ThemeColors`

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/theme/palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES } from "@/features/settings/useSettingsStore";
import { hexToRgb } from "@/lib/color";
import { rgbToOklch, srgbChromaCeiling } from "@/lib/cssColor";

import { contrastRatio } from "./contrast";
import { RAMP_SLOTS, familyHue, tintRamp } from "./palette";

const oklch = (hex: string) => rgbToOklch(hexToRgb(hex)!);

/** The three ramp pairs. accentInk/accent is excluded: the accent is a seed and is never tinted. */
const RAMP_PAIRS = [
  ["fg0", "bg0"],
  ["fg1", "bg1"],
  ["fg2", "bg1"],
] as const;

const band = (r: number) => (r < 3 ? "bad" : r < 4.5 ? "low" : "ok");

describe("familyHue", () => {
  it("is null only for a fully achromatic ramp", () => {
    // Measured: of the nine built-ins, dark-neutral alone has no slot above the
    // chroma floor. light, gruvbox-dark and github-light have achromatic
    // BACKGROUNDS but still resolve a hue from the rest of the ramp.
    for (const t of BUILTIN_THEMES) {
      const hue = familyHue(t.colors);
      if (t.id === "dark-neutral") expect(hue, t.id).toBeNull();
      else expect(hue, t.id).not.toBeNull();
    }
  });

  it("lands on the hue the ramp actually reads as", () => {
    // Measured means, to the nearest degree.
    const expected: Record<string, number> = {
      "dark-cool": 264,
      "dark-warm": 68,
      light: 259,
      nord: 264,
      dracula: 273,
      "solarized-dark": 215,
      "gruvbox-dark": 79,
      "github-light": 251,
    };
    for (const [id, want] of Object.entries(expected)) {
      const t = BUILTIN_THEMES.find((x) => x.id === id)!;
      expect(familyHue(t.colors)!, id).toBeCloseTo(want, -0.5);
    }
  });
});

describe("tintRamp", () => {
  it("is the exact identity at strength 0 on the family hue", () => {
    // The guarantee the whole panel rests on: opening the editor and touching
    // nothing must not move a single byte. Measured 0/14 slots differ on all
    // nine built-ins, worst channel error 0.
    for (const t of BUILTIN_THEMES) {
      const hue = familyHue(t.colors) ?? 0;
      const out = tintRamp(t.colors, hue, 0);
      for (const key of RAMP_SLOTS) {
        expect(out[key], `${t.id}.${key}`).toBe(t.colors[key]);
      }
    }
  });

  it("never changes a contrast verdict, at any hue or strength", () => {
    // 9 themes x 24 hues x 5 strengths x 3 pairs = 3240 checks, measured at
    // 0 band changes. This is what replaces the old non-goal's argument.
    let checks = 0;
    for (const t of BUILTIN_THEMES) {
      for (let hue = 0; hue < 360; hue += 15) {
        for (const strength of [0, 0.25, 0.5, 0.75, 1]) {
          const out = tintRamp(t.colors, hue, strength);
          for (const [a, b] of RAMP_PAIRS) {
            const before = band(contrastRatio(t.colors[a], t.colors[b]));
            const after = band(contrastRatio(out[a], out[b]));
            expect(after, `${t.id} hue=${hue} strength=${strength} ${a}/${b}`).toBe(before);
            checks++;
          }
        }
      }
    }
    expect(checks).toBe(3240);
  });

  it("holds every slot's lightness exactly", () => {
    const base = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!.colors;
    const out = tintRamp(base, 300, 0.6);
    for (const key of RAMP_SLOTS) {
      // 8-bit quantization is the only source of drift, so a tight bound.
      expect(oklch(out[key]).l, key).toBeCloseTo(oklch(base[key]).l, 2);
    }
  });

  it("never asks for more chroma than sRGB can show", () => {
    // Guarantee 3. Without the ceiling clamp the conversion clips per channel,
    // and a clipped channel shifts the hue silently — the exact failure the
    // ceiling exists to prevent, and one that no contrast check would catch.
    for (const t of BUILTIN_THEMES) {
      for (const hue of [0, 90, 180, 270]) {
        const out = tintRamp(t.colors, hue, 1);
        for (const key of RAMP_SLOTS) {
          const o = oklch(out[key]);
          // The slack is one 8-bit step's worth of round-trip error, nothing more.
          expect(o.c, `${t.id}.${key} at hue ${hue}`).toBeLessThanOrEqual(
            srgbChromaCeiling(o.l, o.h) + 0.002,
          );
        }
      }
    }
  });

  it("tints a ramp that has no hue of its own", () => {
    // A multiplier cannot do this: dark-neutral is chroma 0 in all 14 slots.
    const base = BUILTIN_THEMES.find((t) => t.id === "dark-neutral")!.colors;
    expect(tintRamp(base, 300, 0).bg0).toBe(base.bg0);
    expect(tintRamp(base, 300, 1).bg0).not.toBe(base.bg0);
    expect(oklch(tintRamp(base, 300, 1).bg0).c).toBeGreaterThan(0.01);
  });

  it("rotates rather than assigns, so a theme keeps its own hue split", () => {
    // dracula puts its text 171 degrees from its backgrounds on purpose.
    // Assigning one hue flattens that; rotating preserves it.
    const base = BUILTIN_THEMES.find((t) => t.id === "dracula")!.colors;
    const split = (c: typeof base) => {
      const d = oklch(c.fg0).h - oklch(c.bg0).h;
      return Math.abs(((((d % 360) + 540) % 360) - 180));
    };
    for (const target of [0, 120, 210]) {
      expect(split(tintRamp(base, target, 0.4)), `target ${target}`).toBeCloseTo(
        split(base),
        -0.5,
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/palette.test.ts`

Expected: FAIL — cannot resolve `./palette`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/settings/theme/palette.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/palette.test.ts`

Expected: PASS, 7 tests. The contrast sweep asserts `checks === 3240`; if that
number is wrong the built-in set has changed and the guarantee needs re-measuring
rather than the assertion relaxing.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/theme/palette.ts src/features/settings/theme/palette.test.ts
git commit -m "feat(theme): tint a theme's ramp in OKLCh without moving its contrast"
```

---

### Task 3: Harmony offsets and `generate`

**Files:**
- Modify: `src/features/settings/theme/deriveTheme.ts` (export `inkFor`)
- Modify: `src/features/settings/theme/palette.ts`
- Test: `src/features/settings/theme/palette.test.ts`

**Interfaces:**
- Consumes: `RAMP_SLOTS`, `familyHue`, `tintRamp` from Task 2; `inkFor` from
  `./deriveTheme`; `normalizeHex` from `@/lib/color`.
- Produces:
  - `type HarmonyRule = "mono" | "analogous" | "triadic" | "split" | "complementary"`
  - `HARMONY_RULES: readonly { id: HarmonyRule; label: string; ground: number; logo: number; logo2: number }[]`
  - `harmonyOffsets(rule: HarmonyRule)` → one `HARMONY_RULES` entry
  - `type PaletteTraits = { baseId: string; seed: string; rule: HarmonyRule; strength: number }`
  - `DEFAULT_TRAIT_RULE: HarmonyRule` (`"analogous"`) and `DEFAULT_TRAIT_STRENGTH` (`0.35`)
  - `generate(base: ThemeDef, traits: PaletteTraits): ThemeColors`

- [ ] **Step 1: Write the failing test**

Append to `src/features/settings/theme/palette.test.ts` (and extend the import
from `./palette` to include `HARMONY_RULES`, `generate`, `harmonyOffsets`):

```ts
describe("harmony", () => {
  it("never gives the two logo slots the same hue", () => {
    // A literal mirror collapses at 0 and at 180, which is why Monochrome and
    // Complementary are nudged. Without this the mark loses one of its colours
    // on exactly two of the five rules.
    for (const rule of HARMONY_RULES) {
      expect(norm(rule.logo), rule.id).not.toBeCloseTo(norm(rule.logo2), 0);
    }
  });

  it("keeps Monochrome's ground on the seed and defaults to Analogous", () => {
    expect(harmonyOffsets("mono").ground).toBe(0);
    expect(HARMONY_RULES[1].id).toBe("analogous");
  });
});

describe("generate", () => {
  const base = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
  const traits = {
    baseId: base.id,
    seed: "#5aa8e8",
    rule: "analogous" as const,
    strength: 0.35,
  };

  it("puts the seed in the accent slot untouched", () => {
    expect(generate(base, traits).accent).toBe("#5aa8e8");
  });

  it("reproduces the base exactly at strength 0 with the base's own accent", () => {
    // This is what makes opening the editor safe: the generator's neutral
    // position IS the theme you started from.
    const hue = familyHue(base.colors)!;
    const rule = HARMONY_RULES.find(
      (r) => Math.abs(r.ground - (hue - oklch(base.colors.accent).h)) < 15,
    )!;
    const out = generate(base, {
      baseId: base.id,
      seed: base.colors.accent,
      rule: rule.id,
      strength: 0,
    });
    for (const key of RAMP_SLOTS) expect(out[key], key).toBe(base.colors[key]);
  });

  it("moves the ground with the rule but never the accent", () => {
    const mono = generate(base, { ...traits, rule: "mono" });
    const comp = generate(base, { ...traits, rule: "complementary" });
    expect(mono.accent).toBe(comp.accent);
    const apart = Math.abs(
      ((((familyHue(comp)! - familyHue(mono)!) % 360) + 540) % 360) - 180,
    );
    expect(apart).toBeGreaterThan(150);
  });

  it("keeps the button label readable on every generated accent", () => {
    for (const seed of ["#ffee00", "#0b1020", "#5aa8e8", "#7a7a7a", "#808080"]) {
      const out = generate(base, { ...traits, seed });
      expect(contrastRatio(out.accentInk, out.accent), seed).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns the base untouched for a seed that is not a colour", () => {
    const out = generate(base, { ...traits, seed: "not a colour" });
    expect(out).toEqual(base.colors);
  });
});
```

Add this helper beside `oklch` at the top of the file:

```ts
const norm = (deg: number) => ((deg % 360) + 360) % 360;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/palette.test.ts`

Expected: FAIL — `HARMONY_RULES`, `harmonyOffsets` and `generate` are not
exported from `./palette`.

- [ ] **Step 3: Write minimal implementation**

First, in `src/features/settings/theme/deriveTheme.ts`, add `export` to the
existing `inkFor` function — change `function inkFor(` to
`export function inkFor(`. Nothing else in that file changes.

Then append to `src/features/settings/theme/palette.ts`:

```ts
import type { ThemeDef } from "@/features/settings/useSettingsStore";
import { normalizeHex } from "@/lib/color";

import { inkFor } from "./deriveTheme";

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
 * literal mirror because the mirror of 0 is 0 and the mirror of 180 is 180, and
 * either one would collapse the pair.
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
 * goes through `deriveTheme`'s `inkFor` so there is still exactly one rule in
 * the tree about what can be read on a button.
 */
export function generate(base: ThemeDef, traits: PaletteTraits): ThemeColors {
  const seed = normalizeHex(traits.seed);
  const o = seed ? oklchOf(seed) : null;
  // A half-typed hex is not a palette. Hand back the base rather than
  // generating from noise — the editor's own field keeps the user's text.
  if (!seed || !o) return { ...base.colors };

  const off = harmonyOffsets(traits.rule);
  const colors = tintRamp(base.colors, norm360(o.h + off.ground), traits.strength);
  colors.accent = seed;
  colors.accentInk = inkFor(colors, seed);
  colors.logo = rotateTo(base.colors.logo, o.h + off.logo);
  colors.logo2 = rotateTo(base.colors.logo2, o.h + off.logo2);
  return colors;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
~/Library/pnpm/pnpm vitest run src/features/settings/theme/palette.test.ts src/features/settings/theme/deriveTheme.test.ts
```

Expected: PASS. `deriveTheme.test.ts` is in the run because Task 3 touches that
file; adding `export` must not change any behaviour it pins.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/theme/palette.ts src/features/settings/theme/palette.test.ts src/features/settings/theme/deriveTheme.ts
git commit -m "feat(theme): place a palette from one seed and a harmony rule"
```

---

### Task 4: Trait inference and the dice

**Files:**
- Modify: `src/features/settings/theme/palette.ts`
- Test: `src/features/settings/theme/palette.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 and 3.
- Produces:
  - `type TraitLocks = { base: boolean; seed: boolean; rule: boolean; strength: boolean }`
  - `NO_LOCKS: TraitLocks`
  - `inferTraits(theme: ThemeDef): PaletteTraits`
  - `isGenerated(colors: ThemeColors, base: ThemeDef, traits: PaletteTraits): boolean`
  - `rollTraits(current: PaletteTraits, locks: TraitLocks, mode: "dark" | "light", pool: readonly ThemeDef[], rand?: () => number): PaletteTraits`

- [ ] **Step 1: Write the failing test**

Append to `src/features/settings/theme/palette.test.ts` (extending the `./palette`
import with `NO_LOCKS`, `inferTraits`, `isGenerated`, `rollTraits`):

```ts
describe("inferTraits", () => {
  it("round-trips every built-in to itself", () => {
    // No new file format: the traits are read back out of the palette, and
    // because strength 0 is the identity, opening any theme regenerates it
    // exactly. This test is what lets themePayload stay untouched.
    for (const t of BUILTIN_THEMES) {
      const traits = inferTraits(t);
      expect(traits.seed, t.id).toBe(t.colors.accent);
      expect(traits.strength, t.id).toBe(0);
      expect(traits.baseId, t.id).toBe(t.id);
      expect(isGenerated(t.colors, t, traits), t.id).toBe(true);
    }
  });

  it("names the rule the theme actually uses", () => {
    // Measured surface-to-accent angles: dark-warm 1, dark-cool 19,
    // dracula -29, solarized-dark -30. The last two are what pin the
    // magnitude match — signed matching would call both of them Custom.
    const rule = (id: string) => inferTraits(BUILTIN_THEMES.find((t) => t.id === id)!).rule;
    expect(rule("dark-warm")).toBe("mono");
    expect(rule("dark-cool")).toBe("analogous");
    expect(rule("dracula")).toBe("analogous");
    expect(rule("solarized-dark")).toBe("analogous");
  });

  it("falls back to the default rule when the ramp has no hue", () => {
    const neutral = BUILTIN_THEMES.find((t) => t.id === "dark-neutral")!;
    expect(inferTraits(neutral).rule).toBe("analogous");
  });
});

describe("isGenerated", () => {
  it("goes false as soon as a slot is hand-edited", () => {
    const base = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
    const traits = inferTraits(base);
    expect(isGenerated(base.colors, base, traits)).toBe(true);
    expect(isGenerated({ ...base.colors, border1: "#ff00ff" }, base, traits)).toBe(false);
  });
});

describe("rollTraits", () => {
  const base = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
  const traits = inferTraits(base);
  /** A scripted source, so a roll is a fixture rather than a coin toss. */
  const scripted = (...xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length];
  };

  it("respects every lock", () => {
    const locked = { base: true, seed: true, rule: true, strength: true };
    expect(rollTraits(traits, locked, "dark", BUILTIN_THEMES, scripted(0.5))).toEqual(traits);
  });

  it("changes what is not locked", () => {
    const locks = { ...NO_LOCKS, seed: true };
    const out = rollTraits(traits, locks, "dark", BUILTIN_THEMES, scripted(0.1, 0.9, 0.4, 0.7));
    expect(out.seed).toBe(traits.seed);
    expect(out.strength).not.toBe(traits.strength);
  });

  it("keeps the seed inside the band the built-in accents occupy", () => {
    // L 0.52-0.78 and C 0.06-0.19 are the measured span of the nine built-in
    // accents, which is why a rolled theme never lands somewhere unusable.
    for (let i = 0; i < 200; i++) {
      const out = rollTraits(traits, NO_LOCKS, "dark", BUILTIN_THEMES);
      const o = oklch(out.seed);
      expect(o.l).toBeGreaterThanOrEqual(0.51);
      expect(o.l).toBeLessThanOrEqual(0.79);
      expect(out.strength).toBeGreaterThanOrEqual(0.15);
      expect(out.strength).toBeLessThanOrEqual(0.7);
    }
  });

  it("only rolls built-in bases of the draft's own mode", () => {
    for (let i = 0; i < 100; i++) {
      const out = rollTraits(traits, NO_LOCKS, "light", BUILTIN_THEMES);
      const picked = BUILTIN_THEMES.find((t) => t.id === out.baseId)!;
      expect(picked.mode).toBe("light");
      expect(picked.builtin).toBe(true);
    }
  });

  it("never rolls a strength of zero", () => {
    // A dice press that changes nothing visible reads as a broken button.
    for (let i = 0; i < 100; i++) {
      expect(rollTraits(traits, NO_LOCKS, "dark", BUILTIN_THEMES).strength).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/palette.test.ts`

Expected: FAIL — `inferTraits`, `isGenerated`, `rollTraits`, `NO_LOCKS` are not
exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/features/settings/theme/palette.ts`:

```ts
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
 * Reading them back works because `strength: 0` is the exact identity — base is
 * the theme itself, so opening any theme for edit regenerates it byte-for-byte
 * and nothing moves until the user moves something.
 */
export function inferTraits(theme: ThemeDef): PaletteTraits {
  const family = familyHue(theme.colors);
  const accent = oklchOf(theme.colors.accent);
  let rule: HarmonyRule = DEFAULT_TRAIT_RULE;
  if (family !== null && accent) {
    // MAGNITUDE, not the signed angle: a rule's offsets are written one way
    // round (+30) but a theme is equally analogous 30 degrees the other way.
    // Measured, dracula sits at -29 and solarized-dark at -30; matching on the
    // signed value would call both of them Custom.
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
    (key) => want[key] === colors[key],
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

  return {
    baseId:
      locks.base || bases.length === 0
        ? current.baseId
        : bases[Math.min(bases.length - 1, Math.floor(baseRoll * bases.length))].id,
    seed: locks.seed ? current.seed : rgbToHex(oklchToRgb(seedL, seedC, seedH)),
    rule: locks.rule
      ? current.rule
      : ROLL_RULES[Math.min(ROLL_RULES.length - 1, Math.floor(ruleRoll * ROLL_RULES.length))],
    strength: locks.strength ? current.strength : strength,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/palette.test.ts`

Expected: PASS. If `inferTraits` names a rule the second test does not expect,
do NOT widen `RULE_TOLERANCE` to make it pass — re-measure the theme's
`familyHue` minus its accent hue and fix whichever of the two is wrong.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/theme/palette.ts src/features/settings/theme/palette.test.ts
git commit -m "feat(theme): infer palette traits from a theme and roll new ones"
```

---

### Task 5: Traits, locks and shuffle in the editor store

**Files:**
- Modify: `src/features/settings/theme/useThemeEditorStore.ts`
- Test: `src/features/settings/theme/useThemeEditorStore.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_TRAIT_STRENGTH`, `NO_LOCKS`, `PaletteTraits`, `TraitLocks`,
  `generate`, `inferTraits`, `rollTraits` from `./palette`.
- Produces, on `ThemeEditorState`:
  - `traits: PaletteTraits`
  - `locks: TraitLocks`
  - `setTrait: <K extends keyof PaletteTraits>(key: K, value: PaletteTraits[K]) => void`
  - `toggleLock: (key: keyof TraitLocks) => void`
  - `shuffle: () => void`

- [ ] **Step 1: Write the failing test**

Append to `src/features/settings/theme/useThemeEditorStore.test.ts`:

```ts
import {
  BUILTIN_THEMES,
} from "@/features/settings/useSettingsStore";

import { useThemeEditorStore } from "./useThemeEditorStore";

describe("palette traits", () => {
  const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;

  it("opens a draft on traits that regenerate it unchanged", () => {
    useThemeEditorStore.getState().openEdit(dark);
    const s = useThemeEditorStore.getState();
    expect(s.traits.baseId).toBe(dark.id);
    expect(s.traits.seed).toBe(dark.colors.accent);
    expect(s.traits.strength).toBe(0);
    expect(s.colors).toEqual(dark.colors);
  });

  it("regenerates the palette when a trait moves", () => {
    useThemeEditorStore.getState().openEdit(dark);
    useThemeEditorStore.getState().setTrait("strength", 0.6);
    expect(useThemeEditorStore.getState().colors.bg0).not.toBe(dark.colors.bg0);
    // The ramp moved; the accent the user picked did not.
    expect(useThemeEditorStore.getState().colors.accent).toBe(dark.colors.accent);
  });

  it("leaves a locked trait alone through a shuffle", () => {
    useThemeEditorStore.getState().openEdit(dark);
    useThemeEditorStore.getState().toggleLock("seed");
    const seed = useThemeEditorStore.getState().traits.seed;
    for (let i = 0; i < 20; i++) useThemeEditorStore.getState().shuffle();
    expect(useThemeEditorStore.getState().traits.seed).toBe(seed);
    expect(useThemeEditorStore.getState().colors.accent).toBe(seed);
  });

  it("actually changes the palette when nothing is locked", () => {
    useThemeEditorStore.getState().openEdit(dark);
    const before = { ...useThemeEditorStore.getState().colors };
    useThemeEditorStore.getState().shuffle();
    expect(useThemeEditorStore.getState().colors).not.toEqual(before);
  });

  it("does not regenerate over a hand-edited slot", () => {
    // patchColors is the eighteen-slot path. It writes, and nothing more.
    useThemeEditorStore.getState().openEdit(dark);
    useThemeEditorStore.getState().patchColors({ border1: "#ff00ff" });
    expect(useThemeEditorStore.getState().colors.border1).toBe("#ff00ff");
  });

  it("clears traits and locks on close", () => {
    useThemeEditorStore.getState().openEdit(dark);
    useThemeEditorStore.getState().toggleLock("rule");
    useThemeEditorStore.getState().close();
    expect(useThemeEditorStore.getState().locks).toEqual(NO_LOCKS);
  });
});
```

Add `NO_LOCKS` to the file's imports from `./palette`.

- [ ] **Step 2: Run test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/useThemeEditorStore.test.ts`

Expected: FAIL — `setTrait`, `toggleLock` and `shuffle` are not on the store.

- [ ] **Step 3: Write minimal implementation**

In `src/features/settings/theme/useThemeEditorStore.ts`:

Add the imports:

```ts
import {
  DEFAULT_TRAIT_STRENGTH,
  NO_LOCKS,
  generate,
  inferTraits,
  rollTraits,
  type PaletteTraits,
  type TraitLocks,
} from "./palette";
```

Add to the `ThemeEditorState` type, beside `baseId`:

```ts
  /** The four values the palette is generated from. See `palette.ts`. */
  traits: PaletteTraits;
  /** Which traits a shuffle must leave alone. Session state, never persisted. */
  locks: TraitLocks;

  setTrait: <K extends keyof PaletteTraits>(key: K, value: PaletteTraits[K]) => void;
  toggleLock: (key: keyof TraitLocks) => void;
  /** Re-roll every unlocked trait and regenerate. */
  shuffle: () => void;
```

Extend `EMPTY_DRAFT`:

```ts
const EMPTY_DRAFT = {
  open: null,
  name: "",
  themeMode: "dark" as const,
  colors: BUILTIN_THEMES[0].colors,
  originalTheme: null,
  baseId: BUILTIN_THEMES[0].id,
  traits: inferTraits(BUILTIN_THEMES[0]),
  locks: NO_LOCKS,
};
```

Inside the store factory, beside `preview()`, add a regenerate helper:

```ts
  /**
   * Write the traits' palette into the draft and repaint.
   *
   * Keeps `baseId` in step with `traits.baseId`: the "Start from" select and the
   * base-ramp trait are the same choice wearing two names, and letting them
   * drift is how the dialog ends up showing one theme while generating from
   * another.
   */
  const regenerate = (traits: PaletteTraits) => {
    const base = allThemes().find((t) => t.id === traits.baseId);
    if (!base) return;
    set({ traits, baseId: base.id, themeMode: base.mode, colors: generate(base, traits) });
    preview();
  };
```

In `openNew` and `openEdit`, add the trait fields to the `set(...)` call. For
`openNew(source)` and `openEdit(theme)` alike the argument is the theme the draft
starts from, so both read:

```ts
        traits: inferTraits(source),
        locks: NO_LOCKS,
```

(in `openEdit` the variable is `theme`, so `inferTraits(theme)`).

Add the three actions:

```ts
    setTrait(key, value) {
      const s = get();
      if (!s.open) return;
      regenerate({ ...s.traits, [key]: value });
    },

    toggleLock(key) {
      set((s) => ({ locks: { ...s.locks, [key]: !s.locks[key] } }));
    },

    shuffle() {
      const s = get();
      if (!s.open) return;
      regenerate(
        rollTraits(s.traits, s.locks, s.themeMode, allThemes(), Math.random),
      );
    },
```

Rewrite `applyBase` to route through the traits, keeping its existing signature
so the dialog's light/dark re-base flow is unchanged:

```ts
    applyBase(baseId, accent) {
      const s = get();
      const base = allThemes().find((t) => t.id === baseId);
      if (!base) return;
      // A NEW draft is named after the palette it starts from, so re-basing has
      // to move the name too — otherwise "Add theme" leaves you with a
      // "Dracula (custom)" built out of Solarized. Only while the name is still
      // the automatic one: nothing overwrites what the user typed, and an
      // existing theme being edited already has a name of its own.
      const from = allThemes().find((t) => t.id === s.baseId);
      const auto = s.open?.mode === "new" && !!from && s.name === autoName(from);
      if (auto) set({ name: autoName(base) });
      regenerate({ ...s.traits, baseId, seed: accent ?? base.colors.accent });
    },
```

Leave `patchColors`, `setColors`, `revert`, `close` and `save` exactly as they
are. `patchColors` writing without regenerating is the point: a hand edit is a
hand edit, and `isGenerated` is what notices.

- [ ] **Step 4: Run tests to verify they pass**

```bash
~/Library/pnpm/pnpm vitest run src/features/settings/theme/useThemeEditorStore.test.ts
```

Expected: PASS, including every pre-existing case in that file — `applyBase` was
rewritten and the old tests are what prove the re-base flow still behaves.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/theme/useThemeEditorStore.ts src/features/settings/theme/useThemeEditorStore.test.ts
git commit -m "feat(theme): hold palette traits and their locks in the editor store"
```

---

### Task 6: The Palette section in the editor dialog

**Files:**
- Modify: `src/features/settings/theme/ThemeEditorDialog.tsx`
- Test: `src/features/settings/theme/ThemeEditorDialog.test.tsx`

**Interfaces:**
- Consumes: the store surface from Task 5; `HARMONY_RULES`, `isGenerated` from
  `./palette`; `PGSlider` and the `dice`/`lock`/`lockOpen` icons from Task 1.
- Produces: no exports. Test ids `theme-trait-base`, `theme-trait-rule`,
  `theme-trait-tint`, `theme-shuffle`, and `theme-lock-<trait>` per lock.

- [ ] **Step 1: Write the failing test**

Append to `src/features/settings/theme/ThemeEditorDialog.test.tsx`:

```tsx
describe("palette section", () => {
  it("shuffles the palette and leaves a locked seed alone", () => {
    const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
    useThemeEditorStore.getState().openEdit(dark);
    render(<ThemeEditorDialog />);

    fireEvent.click(screen.getByTestId("theme-lock-seed"));
    const seed = useThemeEditorStore.getState().traits.seed;
    fireEvent.click(screen.getByTestId("theme-shuffle"));

    expect(useThemeEditorStore.getState().traits.seed).toBe(seed);
    expect(useThemeEditorStore.getState().colors.bg0).not.toBe(dark.colors.bg0);
  });

  it("says Custom once a slot is hand-edited", () => {
    const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
    useThemeEditorStore.getState().openEdit(dark);
    render(<ThemeEditorDialog />);
    expect(screen.queryByText("Custom")).toBeNull();

    // act() because this drives the store directly rather than through an
    // event — without it React has not flushed the re-render when the
    // assertion runs, and the test fails for a reason that is not the feature.
    act(() => {
      useThemeEditorStore.getState().patchColors({ border1: "#ff00ff" });
    });
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("has no native select and no native colour input", () => {
    // Both are guard-tested repo-wide, but the section is where a new one would
    // land, so assert it here too rather than finding out from a guard.
    const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
    useThemeEditorStore.getState().openEdit(dark);
    const { container } = render(<ThemeEditorDialog />);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('input[type="color"]')).toBeNull();
  });
});
```

Use `fireEvent`, not `userEvent`: `userEvent.setup()` swaps
`navigator.clipboard` for its own stub, and `fireEvent` is this repo's house
pattern for these dialogs.

- [ ] **Step 2: Run test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/ThemeEditorDialog.test.tsx`

Expected: FAIL — no element with test id `theme-lock-seed`.

- [ ] **Step 3: Write minimal implementation**

In `src/features/settings/theme/ThemeEditorDialog.tsx`, add to the imports:

```tsx
import { PGSlider } from "@/design";

import { HARMONY_RULES, isGenerated, type HarmonyRule, type TraitLocks } from "./palette";
```

`act` joins the test file's existing `@testing-library/react` import.

Delete the existing `<Field label="Start from">` block and the
`<div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>` block that
holds the Accent `ColorField` and its hint. Replace both with:

```tsx
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "10px 12px",
                border: "1px solid var(--border-0)",
                borderRadius: "var(--r-3)",
                background: "var(--bg-1)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <PGIcon name="palette" size={12} style={{ color: "var(--accent)" }} />
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-10)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--fg-2)",
                    fontWeight: 600,
                  }}
                >
                  Palette
                </div>
                <div style={{ flex: 1 }} />
                {!generated && (
                  <span style={{ fontSize: "var(--fs-10)", color: "var(--fg-3)" }}>
                    Custom
                  </span>
                )}
              </div>

              <TraitRow label="Base ramp" trait="base" locks={ed.locks} onLock={ed.toggleLock}>
                <PGSelect
                  data-testid="theme-trait-base"
                  title="Which theme supplies the lightness ramp"
                  value={ed.traits.baseId}
                  onChange={(v) => ed.setTrait("baseId", v)}
                  options={baseOptions}
                  size="sm"
                  style={{ flex: 1 }}
                />
              </TraitRow>

              <TraitRow label="Seed" trait="seed" locks={ed.locks} onLock={ed.toggleLock}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <ColorField
                    label="Seed"
                    hint="One colour. It becomes the accent, and the rest of the palette is placed around it."
                    value={ed.traits.seed}
                    onChange={(v) => ed.setTrait("seed", v)}
                    badge={<RatioBadge a="accentInk" b="accent" colors={ed.colors} />}
                    palette={ed.colors}
                    slot="accent"
                  />
                </div>
              </TraitRow>

              <TraitRow label="Harmony" trait="rule" locks={ed.locks} onLock={ed.toggleLock}>
                <PGSelect
                  data-testid="theme-trait-rule"
                  title="Where the ground and the logo colours sit, relative to the seed"
                  value={ed.traits.rule}
                  onChange={(v) => ed.setTrait("rule", v as HarmonyRule)}
                  options={HARMONY_RULES.map((r) => ({ value: r.id, label: r.label }))}
                  size="sm"
                  style={{ flex: 1 }}
                />
              </TraitRow>

              <TraitRow label="Tint" trait="strength" locks={ed.locks} onLock={ed.toggleLock}>
                <div style={{ flex: 1, minWidth: 0 }} data-testid="theme-trait-tint">
                  <PGSlider
                    name="Tint"
                    valueText={`${Math.round(ed.traits.strength * 100)}%`}
                    min={0}
                    max={1}
                    step={0.01}
                    value={ed.traits.strength}
                    trackCss={`linear-gradient(90deg, ${ed.colors.bg1}, ${ed.colors.accent})`}
                    onChange={(v) => ed.setTrait("strength", v)}
                  />
                </div>
              </TraitRow>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PGButton
                  data-testid="theme-shuffle"
                  size="sm"
                  icon="dice"
                  onClick={ed.shuffle}
                  title="Re-roll every unlocked trait"
                >
                  Shuffle
                </PGButton>
                <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}>
                  Lock what you want to keep. All 18 colours stay editable below.
                </div>
              </div>
            </div>
```

Add `generated` beside the existing `findings` computation near the top of the
component:

```tsx
  const base = [...BUILTIN_THEMES, ...customThemes].find((t) => t.id === ed.traits.baseId);
  const generated = base ? isGenerated(ed.colors, base, ed.traits) : true;
```

Add the `TraitRow` helper beside the existing `Field` and `RatioBadge` helpers at
the bottom of the file:

```tsx
/**
 * One trait, with the lock that decides whether a shuffle may touch it.
 *
 * The lock is a button and not a checkbox because its state is the icon: a
 * closed padlock reads as "keep this" at a glance in a row of four, where a
 * ticked box reads as "this is on" and leaves you working out what "on" meant.
 */
function TraitRow({
  label,
  trait,
  locks,
  onLock,
  children,
}: {
  label: string;
  trait: keyof TraitLocks;
  locks: TraitLocks;
  onLock: (key: keyof TraitLocks) => void;
  children: React.ReactNode;
}) {
  const locked = locks[trait];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label
        style={{
          fontSize: "var(--fs-12)",
          color: "var(--fg-2)",
          width: 76,
          flexShrink: 0,
        }}
      >
        {label}
      </label>
      {children}
      <button
        type="button"
        data-testid={`theme-lock-${trait}`}
        onClick={() => onLock(trait)}
        aria-pressed={locked}
        title={locked ? `${label} is locked — shuffle will keep it` : `Lock ${label}`}
        style={{
          display: "flex",
          alignItems: "center",
          background: "transparent",
          border: "none",
          padding: 2,
          cursor: "pointer",
          color: locked ? "var(--accent)" : "var(--fg-3)",
          flexShrink: 0,
        }}
      >
        <PGIcon name={locked ? "lock" : "lockOpen"} size={12} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
~/Library/pnpm/pnpm vitest run src/features/settings/theme/ThemeEditorDialog.test.tsx
~/Library/pnpm/pnpm exec tsc --noEmit
```

Expected: PASS on both, including every pre-existing case in
`ThemeEditorDialog.test.tsx` — two blocks were deleted from the component and
those tests are what prove nothing else depended on them.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/theme/ThemeEditorDialog.tsx src/features/settings/theme/ThemeEditorDialog.test.tsx
git commit -m "feat(theme): add the palette section with locks and a shuffle"
```

---

### Task 7: Bring the docs back in line

The 2026-09-09 spec and `docs/dev/frontend.md` both state a non-goal this feature
reverses. Leaving either one contradicting the code is how the next session
re-litigates a decision that has already been made and measured.

**Files:**
- Modify: `docs/dev/frontend.md`
- Modify: `docs/superpowers/specs/2026-09-09-theme-editor-revamp-spec.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Run the doc guards first, to see them green before the edit**

```bash
~/Library/pnpm/pnpm vitest run --project docs
```

Expected: PASS. `docs.test.ts` does not read `docs/superpowers/`, so only the
`docs/dev/frontend.md` edit is in its scope — but a green baseline is what tells
you afterwards that a failure is yours.

- [ ] **Step 2: Edit `docs/dev/frontend.md`**

In the "Contrast warnings advise, never block" bullet, replace this sentence:

> `deriveTheme` is the guided start (base + accent) and recalculates
> `accentInk` alone, preferring the base theme's own inks so derived themes stay
> in the family — it is deliberately not a palette generator, because shifting
> the greys too produces palettes nobody can predict or correct.

with:

> `deriveTheme` is the accent swap the eighteen-slot path uses and recalculates
> `accentInk` alone, preferring the base theme's own inks so derived themes stay
> in the family.

Then add a new bullet immediately after it:

> - **The palette generator holds LIGHTNESS and rewrites hue and chroma**
>   (`theme/palette.ts`). The editor's four traits — base ramp, seed colour,
>   harmony rule, tint strength — are the only inputs, each one lockable so the
>   shuffle re-rolls the rest. The earlier "deliberately not a palette
>   generator" rule was about HSL, where hue and lightness are one knob; OKLCh
>   separates them, and holding `l` is what keeps the base's hand-tuned ramp and
>   its contrast intact. Three properties are pinned by `palette.test.ts` and
>   are the reason the reversal is defensible: strength 0 reproduces the base
>   BYTE-FOR-BYTE (so opening the editor moves nothing), no hue at any strength
>   changes an AA verdict (measured 0 changes in 3240), and every output lands
>   in sRGB via `srgbChromaCeiling`. The hue is a ROTATION, not an assignment —
>   dracula, solarized-dark and gruvbox-dark put their text at a different hue
>   from their surfaces on purpose, and assigning one hue flattens that. Traits
>   are INFERRED from the palette on open, never persisted, so the theme file
>   format is unchanged; a hand-edited slot simply flips the readout to
>   "Custom". `SEMANTIC_TOKENS` and `SYNTAX_TOKENS` stay out of it: diff green
>   carries meaning and a palette choice must not change what a diff says.

- [ ] **Step 3: Amend the superseded non-goal**

In `docs/superpowers/specs/2026-09-09-theme-editor-revamp-spec.md`, under
"What this deliberately does not do", replace the bullet:

> - No hue-shifting palette generator. `deriveTheme` swaps the accent and fixes
>   the ink; anything cleverer produces palettes the user cannot predict or
>   correct.

with:

> - ~~No hue-shifting palette generator.~~ **Superseded 2026-09-11** by
>   `2026-09-11-theme-palette-harmony-design.md`. The objection was about HSL,
>   where hue and lightness are one knob; OKLCh landed since, for the colour
>   picker, and separates them. Holding lightness makes a generator both
>   predictable (strength 0 reproduces the base byte-for-byte) and correctable
>   (it writes plain hex into the same eighteen slots). Both were measured
>   across all nine built-ins before the reversal.

- [ ] **Step 4: Run the full suite**

```bash
~/Library/pnpm/pnpm test
```

Expected: PASS, all projects. This is the last verification in the plan and it
must come after the last edit — a green number is only evidence for the tree it
ran on. Note the total test count for the PR body.

- [ ] **Step 5: Commit**

```bash
git add docs/dev/frontend.md docs/superpowers/specs/2026-09-09-theme-editor-revamp-spec.md
git commit -m "docs(theme): record the palette generator and retire its old non-goal"
```

---

## Finishing

- [ ] Push the branch and open a PR against `main`. The branch is
      `feat/theme-palette-harmony`; do not commit to `main` directly.
- [ ] PR body: what the four traits are, the three measured guarantees with their
      numbers, and that it reverses the 2026-09-09 non-goal deliberately. End
      with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] Merge with `gh pr merge <N> --rebase` once GitHub reports the PR mergeable.
      Verify the ruleset still lists `rebase` in `allowed_merge_methods` first —
      the docs and the ruleset have disagreed before.
- [ ] No e2e run is needed: this adds no IPC, no window and no native dialog. CI
      runs the full suite anyway.
