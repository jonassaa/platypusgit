# Palette harmony + shuffle for the theme editor — spec

No issue: requested directly, with Arc's theme creator named as the reference —
"you add some colours to a common palette and then they are complementary to
each other" — plus a shuffle button, "like a character creator with traits in a
game".

## What the editor does today, and why that is not enough

`ThemeEditorDialog` offers a guided start: pick a base theme, pick an accent.
`deriveTheme(base, accent)` copies the base's eighteen slots, replaces `accent`,
and recalculates `accentInk` so the button label stays readable. Everything else
is the base's, unchanged. Behind a disclosure sit all eighteen slots as hex
fields.

So the only way to get a window that does not look like one of the nine
built-ins is to hand-edit fourteen greys, one at a time, in a list, against a
preview — and to know, while doing it, which of them is a background and which
is a border and how far apart two steps of the ramp should be. Nobody does that.
In practice every custom theme is a built-in with a different accent.

## The decision this reverses

Both the 2026-09-09 spec and `docs/dev/frontend.md` record a deliberate
non-goal:

> No hue-shifting palette generator. `deriveTheme` swaps the accent and fixes
> the ink; anything cleverer produces palettes the user cannot predict or
> correct.

That was correct when written and it is worth being precise about why it no
longer is. The objection is about **HSL**, where hue and lightness are the same
knob wearing two hats: rotating hue in HSL moves perceived lightness with it, so
a generated ramp's contrast lands wherever it lands, and the user has no way to
see it coming or walk it back.

Since then `src/lib/cssColor.ts` landed **OKLCh** for the colour picker —
`rgbToOklch`, `oklchToRgb`, `srgbChromaCeiling`, `inSrgbGamut`. In OKLCh
lightness is separable. A generator can rewrite hue and chroma while holding
every slot's lightness **exactly**, and the ramp the built-in hand-tuned survives
the rewrite. That is not a hope; the Measured guarantees section below is three
properties with numbers against all nine built-ins.

The "correct" half of the objection never needed an argument, and this design
keeps it literally true: generation writes plain hex into the same eighteen
slots. There is no hidden layer, no derived-value indirection, no second source
of truth. Every slot stays editable, Revert still reverts, the theme file format
does not change.

## The model: four traits

A generated palette is a pure function of four values. They are the character
sheet: each has a lock, and the shuffle re-rolls every unlocked one.

| Trait | Type | What it decides |
| --- | --- | --- |
| **Base ramp** | theme id | Supplies every slot's lightness and its baseline chroma |
| **Seed** | one colour | Becomes `accent` verbatim |
| **Harmony** | one of five | Hue offsets for the ground and the logo pair |
| **Tint** | 0 → 1 | How far the ground's chroma is pushed past the base's own |

`Tint = 0` is the identity (see below), so "no generation" is a position on the
slider rather than a mode.

### Harmony offsets

The ground takes the rule's angle. `logo` and `logo2` sit on opposite sides of
the seed wherever the rule allows, so the mark always carries two
distinguishable colours; Monochrome and Complementary are nudged because a
literal mirror would collapse the pair (the mirror of 0° is 0°, and of 180° is
180°).

| Rule | ground Δ | `logo` Δ | `logo2` Δ |
| --- | --- | --- | --- |
| Monochrome | 0° | −30° | +30° |
| **Analogous** (default) | +30° | −30° | +60° |
| Triadic | +120° | +120° | −120° |
| Split-complement | +150° | +150° | −150° |
| Complementary | +180° | +180° | −60° |

These exact numbers are the spec, but the implementation may tune them against
the live preview within three invariants: Monochrome's ground offset is 0,
Analogous is the default, and no rule may give `logo` and `logo2` the same hue.

**Why Analogous is the default.** Measured across the nine built-ins, every one
places its surface hue close to its accent — five within 20°, three within 46°,
and `dark-neutral` has no surface hue at all. Not one is complementary or
triadic:

```
theme            family  accent   delta   nearest
dark-cool           264     245      19   mono
dark-warm            68      67       1   mono
dark-neutral        n/a     252     n/a   (achromatic ramp)
light               259     260      -1   mono
nord                264     217      46   analogous
dracula             273     302     -29   analogous
solarized-dark      215     245     -30   analogous
gruvbox-dark         79      78       1   mono
github-light        251     257      -7   mono
```

The wide angles stay on offer — a warm ground under a cool accent is a good look
that none of the nine happens to use, and exploring past the built-ins is the
whole point of the feature. But it is the adventurous setting, not the one you
get for free.

## The engine

One new pure module, `src/features/settings/theme/palette.ts`. No React, no DOM,
no store — the same reasoning `colorWheel.ts` and `contrast.ts` give.

`deriveTheme.ts` **stays as it is.** It is still the right answer for "swap the
accent on a theme I am hand-editing", it is what the eighteen-slot path uses, and
the generator calls its `inkFor` rather than growing a second ink rule.

### `familyHue(colors): number | null`

The base ramp's own hue: the chroma-weighted circular mean over the fourteen
ramp slots, skipping any with chroma below 0.004. `null` only when no slot clears the floor, which of the
nine is `dark-neutral` alone. `light`, `gruvbox-dark` and `github-light` have
achromatic *background* slots that the floor skips, and still resolve a family
hue from the rest of the ramp.

Weighting by chroma and not taking a plain mean matters because the slots differ
by an order of magnitude — `solarized-dark`'s `bg4` carries chroma 0.066 while
its `fg2` carries 0.016 — and the strongly-tinted slots are the ones that decide
what family the theme reads as.

### `tintRamp(colors, groundHue, strength): ThemeColors`

For each of the fourteen ramp slots (`bg0`–`bg4`, `titlebar`, `fg0`–`fg4`,
`border0`–`border2`):

```
if strength == 0: return colors unchanged                            // see below
o = rgbToOklch(slot)
h = familyHue === null ? groundHue : o.h + (groundHue − familyHue)   // ROTATE
c = min(o.c + strength × 0.06, srgbChromaCeiling(o.l, h))
out = oklchToRgb(o.l, c, h)                                          // o.l HELD
```

**The `strength == 0` short-circuit is load-bearing, and was added during
implementation.** Without it the identity holds only when the ground hue happens
to equal the base's own family hue — and it almost never does, because the
ground is `seed + the rule's quantised angle` while a base's real offset is
whatever it is (dark-cool's is 18.6°, and no rule has that). Rotating a ramp
that still carries its own chroma changes every slot, so merely opening the
editor moved `bg0` from `#1a1d24` to `#1b1d24` before the user touched anything.
The cost is a step at the very bottom of a slider that defaults to 0.35.

Three things in there are load-bearing, and each one is a measurement, not a
preference.

**The hue is a rotation, not an assignment.** Five of the nine built-ins run a
single hue across the whole ramp (spread 8–16°) and a sixth, `dark-neutral`, has
no hue at all — for those six the two are the same thing. The other three are
not: `dracula` puts its text at 107° and its
backgrounds at 278°, `solarized-dark` at 90° against 220°, `gruvbox-dark` at 76–96°
against 49–61°. Assigning one absolute hue flattens that split and throws away
what makes those themes look like themselves. Rotating preserves it — measured,
dracula's 171° text-versus-surface split is preserved to within 2° at every
rotation target tested.

**The chroma is additive over the base's own, not a replacement.** A multiplier
cannot tint an achromatic ramp: `dark-neutral` is chroma 0 in all fourteen slots,
and any multiple of zero is zero. Measured, the additive form takes
`dark-neutral`'s `#1c1c1c` to `#211434` at full strength while leaving it exactly
`#1c1c1c` at zero.

**The lightness is held, never recomputed.** This is what makes the contrast
guarantee hold, and it is also what preserves the spacing of the ramp's steps —
the part of a theme that takes the longest to tune by hand and that a user has
no vocabulary to fix once it is wrong.

### `generate({ baseId, seed, rule, strength }): ThemeColors`

```
ground  = seed.h + rule.groundΔ
colors  = tintRamp(base.colors, ground, strength)
accent  = seed                                       // verbatim, never tinted
accentInk = inkFor(colors, accent)                   // deriveTheme.ts
if strength > 0:                                     // see below
  logo  = base.logo  at hue seed.h + rule.logoΔ,  chroma clamped to its ceiling
  logo2 = base.logo2 at hue seed.h + rule.logo2Δ, chroma clamped to its ceiling
```

The logo pair keeps the base's own lightness and chroma and moves only in hue,
for the same reason the ramp does — and it is gated on strength for the same
reason too. A rule places the mark at angles a theme's own logo was never drawn
at, so without the gate every built-in read as "Custom" the instant it opened.

Gating it buys a property worth stating on its own: **at tint 0 this function
degenerates to exactly `deriveTheme`**, the accent swap that shipped before it,
and at tint 1 it is a fully generated palette. Tint is the one master control,
and `palette.test.ts` asserts the equality against `deriveTheme` itself so the
two cannot drift into two answers.

## Measured guarantees

Three properties. Each one is a test in `palette.test.ts`, not a claim in prose.

**1. Tint 0 is the identity, under every rule.** Verified against all nine
built-ins × all five rules: 0 of 14 slots differ, worst channel error 0.
Byte-for-byte. The generator's neutral position *is* the theme you started from,
which is what makes the whole panel safe to touch — there is no way to open the
editor and silently be somewhere else.

The "under every rule" half is not decoration. Written the weak way — picking
the rule nearest the base's own offset — this test passes against a generator
that rotates the ramp at tint 0, which is the bug described above.

**2. Tinting never changes a contrast verdict.** Across 9 themes × 24 hues × 5
strengths × the 3 ramp pairs in `CONTRAST_PAIRS` — **0 band changes out of
3240**. No hue at any strength moves a pair across the AA 4.5 or the AA-large 3
boundary. Worst absolute drift anywhere was 1.101, on `solarized-dark`'s
`fg1`/`bg1` moving 10.76 → 11.86.

```
theme            worst drift   band changes
dark-cool              0.266        0/360
dark-warm              0.266        0/360
dark-neutral           0.170        0/360
light                  0.455        0/360
nord                   0.337        0/360
dracula                0.738        0/360
solarized-dark         1.101        0/360
gruvbox-dark           0.317        0/360
github-light           0.472        0/360
```

The fourth pair, `accentInk`/`accent`, is excluded from that sweep because the
accent is a seed and is never tinted; its ink goes through the existing
`inkFor`, which is already tested.

**3. Every output is inside sRGB by construction**, via the `srgbChromaCeiling`
clamp. The ceiling is strongly hue- and lightness-dependent — at `fg0`'s
L = 0.957 it is 0.024 at hue 300 but 0.141 at hue 120 — so the clamp is the
normal path near the ends of the ramp, not an edge case.

## What was tried and cut

A luminance-matched variant: after tinting, binary-search lightness so each
slot's WCAG relative luminance matches the base slot's exactly, making contrast
preservation exact rather than merely measured. Built, measured, **cut**.

It is *worse* than holding lightness across the useful range — worst drift 0.178
against 0.126 at strength 0.01, 0.181 against 0.100 at 0.02 — and only wins above
strength 0.08, where the drift it beats is already invisible. The reason is that
8-bit quantization sets a floor around 0.15 ratio points that the search cannot
get under, and the search's own convergence error sits on top of it. It would
have been thirty lines of bisection buying nothing. Holding lightness is the
whole algorithm.

## Shuffle and locks

One dice re-rolls every unlocked trait. It cannot produce an unusable theme,
because the four traits are the only inputs and each rolls inside a band:

- **Seed** — hue uniform over [0, 360); lightness uniform over [0.52, 0.78];
  chroma uniform over [0.06, 0.19], clamped to `srgbChromaCeiling`. Those two
  ranges are the measured span of the nine built-in accents (L 0.518–0.775,
  C 0.062–0.191), so a rolled accent sits where a hand-picked one sits.
- **Base ramp** — uniform over the **built-ins** matching the draft's current
  mode. Not custom themes: rolling into someone's half-finished draft is a
  surprise, and the built-ins are the ones with a calibrated ramp.
- **Harmony** — weighted, with Monochrome and Analogous at twice the weight of
  the other three. The measured evidence above is that the near angles are what
  reads as a designed theme; the dice should land there more often.
- **Tint** — uniform over [0.15, 0.70]. Never 0, because a roll that changes
  nothing visible reads as a broken button.

A lock is per-trait, lives in the editor store, and is session state — it is not
persisted and not part of the theme.

The default on a fresh draft is Analogous at tint 0.35.

## Where the traits come from when the editor opens

No new persisted format. The traits are inferred from the palette that is already
there, which works out exactly because of guarantee 1:

- **Base ramp** — the theme being edited, which `useThemeEditorStore` already
  tracks as `baseId`.
- **Seed** — `colors.accent`.
- **Tint** — 0.
- **Harmony** — the rule whose ground offset is nearest the **magnitude** of
  `familyHue(colors) − hue(accent)`, within ±15°, falling back to the default
  rule when nothing is that near or when `familyHue` is `null`. Magnitude and
  not the signed angle, because a rule's offsets are written one way round
  (+30°) while a theme is equally analogous 30° the other way — measured,
  `dracula` sits at −29.0° and `solarized-dark` at −30.1°, and signed matching
  would fail to name either.

The `"Custom"` readout is **not** a sixth rule and does not come from inference.
It is `isGenerated(colors, base, traits)` going false — the palette is no longer
exactly what the traits produce, because a slot was hand-edited.

`isGenerated` compares every slot **except `accentInk`**, which is a consequence
rather than a choice. The built-ins ship hand-authored inks that `inkFor` would
not pick off their own ramps — dark-cool carries `#0e1a26` where `inkFor` picks
`#1a1d24` — so comparing it made every built-in read as "Custom" the moment it
was opened, which is the opposite of what the readout is for.

Base = the theme itself and tint = 0 means the generator is the identity on
open. Nothing moves until the user moves something. `themePayload`,
`normalizeCustomThemes` and `validateTheme` are untouched.

Hand-editing any generated slot afterwards is just editing a slot. The harmony
readout flips to `"Custom"` when the palette stops matching what the traits
would generate, and the next shuffle or trait change regenerates over the hand
edits — which is inherent to any generator and is what Revert is for.

## UI

The palette section **replaces** the existing "Start from" and "Accent" rows in
`ThemeEditorDialog`'s left column. It is not a second panel beside them: base
ramp *is* "Start from" and seed *is* "Accent", grown a harmony picker, a tint
slider, four locks and a dice.

```
┌─ Palette ──────────────────────────  Custom ┐
│  Base ramp   [ Dark · Cool      ▾ ]      🔓 │
│  Accent      [ ● #5aa8e8        ]        🔓 │
│  Harmony     [ Analogous        ▾ ]      🔓 │
│  Tint        ●────────●────────  35%     🔓 │
│                                             │
│  [ 🎲 Shuffle ]  Lock what you want to keep │
└─────────────────────────────────────────────┘

▸ All colours (18)
```

The seed's row is labelled **Accent**, not "Seed". The seed *becomes* the accent
verbatim, so the app's own vocabulary is the clearer one and the generator's
jargon buys nothing; the row's hint carries the "everything else is placed
around it" meaning. It also keeps the base select on its existing
`theme-editor-base` test id, so the two dialog tests that already drive the
guided start keep testing it.

Existing house rules this inherits rather than reinvents: the seed uses
`PGColorSwatch` (no native `<input type="color">` — guard-tested), the base ramp
uses `PGSelect` (no native `<select>` — guard-tested), the live `:root` preview
and the `ThemePreview` pane both already repaint from the draft, and the
contrast findings under the preview keep advising and never block.

The tint slider needs a real control; `design/color-picker.tsx` already has the
slider used for its channel tracks, and the implementation should reuse it
rather than add a second slider to the design system.

## Files

**New**
- `src/features/settings/theme/palette.ts` — `familyHue`, `tintRamp`,
  `harmonyOffsets`, `generate`, `inferTraits`, `rollTraits`.
- `src/features/settings/theme/palette.test.ts` — the three guarantees above,
  each swept over all nine built-ins, plus the roll bands and the inference
  round-trip.

**Changed**
- `src/features/settings/theme/ThemeEditorDialog.tsx` — the palette section.
- `src/features/settings/theme/useThemeEditorStore.ts` — four trait fields, four
  locks, `setTrait`, `shuffle`; `applyBase` becomes a trait write.
- `docs/dev/frontend.md` — the "deliberately not a palette generator" sentence
  in the contrast bullet is now wrong and must change in the same commit.
- `docs/superpowers/specs/2026-09-09-theme-editor-revamp-spec.md` — its
  "No hue-shifting palette generator" non-goal gets a line pointing here, rather
  than being left contradicting the code.

`CLAUDE.md` gets **no new bullet.** The rules that matter here are already
written (one colour picker, no native `<select>`, contrast advises and never
blocks) and this feature obeys them rather than adding one. A pointer that
`docs/dev/frontend.md` already serves does not earn a line in a file that was cut
from 2,456 lines.

## Testing

- **`palette.test.ts`** (vitest `unit`) — the three guarantees, swept. These are
  the tests that make the reversal of the old non-goal defensible, so they assert
  the *numbers*, not just "it returns a colour": identity is byte equality across
  all nine built-ins, and the contrast sweep asserts 0 band changes over the full
  9 × 24 × 5 × 3 grid.
- **`ThemeEditorDialog.test.tsx`** — a shuffle with the seed locked leaves
  `colors.accent` untouched and changes at least one ramp slot; tint 0 leaves the
  draft byte-identical to the base; changing harmony moves the ground hue and not
  the accent.
- **No new e2e.** The editor already has coverage for open/edit/save, and this
  adds no new IPC, no new window, and no native dialog. The arithmetic is where
  the risk is and it is unit-testable.

## What this deliberately does not do

- **No change to `SEMANTIC_TOKENS` or `SYNTAX_TOKENS`.** Diff green stays green:
  those colours carry meaning, and harmonising them would make a palette choice
  change what a diff says. `--graph-1..7` are the one arguable exception — they
  are already `oklch(0.72 0.15 h)` at seven hues, so a rigid rotation would keep
  them mutually distinguishable while letting the palette reach the log graph.
  Left out on purpose; it is a separate change with its own argument to make.
- **No new theme file format.** Traits are inferred, not stored. The moment
  traits are persisted, a theme has two sources of truth and every importer has
  to decide which wins.
- **No blocking on contrast.** Unchanged from the 2026-09-09 spec: the editor
  warns, Save is never disabled, and a deliberately low-contrast theme is the
  user's own call. Guarantee 2 means the generator never *causes* a finding that
  the base did not already have.
- **No gamut-mapping beyond the chroma clamp.** `srgbChromaCeiling` ends the
  chroma at the right place; there is no perceptual gamut compression, because
  the alternative to clamping here is a per-channel clamp that shifts the hue
  silently, and that is the bug the ceiling exists to prevent.
- **No palette import from an image or a URL.** Out of scope, and it would be the
  app's first network call — see the privacy build gate.
