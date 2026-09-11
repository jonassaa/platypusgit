# Global spacing + text size — spec

No issue: requested directly — "lets add some settings for global spacing and
font size, the app can feel a bit dense some times and for some users it might
be better to have a bit larger font and more spacing. replace the 'comfortable'
'dense' ui settings."

## What exists today, and why it is not enough

Appearance has one row-geometry control: **UI density**, a two-value select
(`compact` | `comfortable`) backed by `DENSITY_STEP_PX = { compact: 0,
comfortable: 4 }`. `applyDensity` writes the chosen number to `--row-step` on
`:root`, and 26 style call sites opt in with `calc(<their base>px + var(--row-step))`
— or `calc(<base>px + var(--row-step) / 2)` for vertical padding, since top and
bottom each take half. Compact is 0 by definition, so the shipped default is
pixel-identical to the pre-density layout.

Two things are missing from that.

**It is binary.** The whole range on offer is four pixels. "Feels dense" is not
a yes/no question, and a user who wants a genuinely roomy list has nothing to
pick.

**It does not touch type at all.** Density moves rows apart; it does not make
a single character larger. A user who finds 13px body text hard to read gets no
help from it. The type ramp — `--fs-10` through `--fs-40`, used at 380 sites
across 85 files — is fixed at build time.

There is a third control that *does* move type: **Zoom** (`--fs`-agnostic,
60–240%, `Mod+=` / `Mod+-` / `Mod+0`), which scales the entire UI through the
webview's own zoom factor. It is not a substitute for a text-size setting,
because it is deliberately uniform: it grows borders, icons, the titlebar and
whitespace along with the text. Someone who wants *readable text in the same
amount of screen* cannot express that with zoom, and someone who wants *roomier
rows at the same text size* cannot either.

## The decision: three knobs, each doing one thing

Zoom stays exactly as it is. Density is replaced by two independent settings.
The three compose, and each answers a question the other two cannot:

| Control | Scales | Answers |
|---|---|---|
| **Zoom** (unchanged) | everything — type, chrome, icons, borders | "this whole app is too small on my display" |
| **Text size** (new) | the type ramp, row bases, text-derived column widths | "I want to read the text without giving up rows" |
| **Spacing** (new, replaces density) | row heights and row padding | "the lists feel cramped" |

Keeping all three is a deliberate cost: the Appearance page grows to three size
controls. The alternative — folding text size into zoom — was rejected because
whole-UI zoom is the only one of the three that cannot answer either half of the
request without also answering the other.

## §1 — The settings

`uiDensity` is retired. Two persisted keys replace it.

```ts
export const SPACING_STEP_PX = {
  compact: 0,
  cozy: 2,
  comfortable: 4,
  spacious: 8,
} as const;
export type UiSpacing = keyof typeof SPACING_STEP_PX;

export const TEXT_SCALE = {
  small: 0.92,
  default: 1,
  large: 1.15,
  larger: 1.3,
} as const;
export type UiTextScale = keyof typeof TEXT_SCALE;
```

Labels in the picker are **Compact · Cozy · Comfortable · Spacious** and
**Small · Default · Large · Larger**. Every spacing label describes what it
looks like rather than which one ships, so the default stays findable by
appearance and the vocabulary does not go stale if the default ever moves.
`Compact` and `Comfortable` keep their current meanings and their current pixel
values, so an upgrading user recognises both.

### Defaults, and what happens on upgrade

**The shipped default becomes `cozy` (+2px), and an existing install on
`compact` is migrated to `cozy`.** `comfortable` stays `comfortable`.

This moves pixels under existing users, which is the kind of thing this codebase
normally refuses to do, so the reasoning is worth stating plainly. The premise
of the request is that *today's shipped default is too dense*. A persisted
`uiDensity: "compact"` cannot be distinguished from "never touched it" —
`load()` fills missing keys from `DEFAULTS` and the result is written back — so
grandfathering `compact` means the fix reaches new installs only, which is
nobody who has already formed the opinion that prompted it. Two pixels per row
is a mild change, it is one click reversible, and there is direct precedent in
this same function: the `headIndicator` → `headMarks` migration deliberately
lands an upgraded install on a *more* visible value, with the reasoning written
at the call site.

`uiTextScale` defaults to `default` (×1) on every install, new or upgraded.
Nobody's type changes size without asking.

### Migration

In `load()`, mirroring the `headIndicator` → `headMarks` shape — reading
`parsed`, not `out`, because the old key is gone from the schema and the copy
loop never picks it up:

```
parsed.uiDensity === "comfortable"  → uiSpacing: "comfortable"
parsed.uiDensity === "compact"      → uiSpacing: "cozy"       (see above)
parsed.uiSpacing present and known  → itself (wins over uiDensity)
anything else                       → DEFAULTS.uiSpacing
```

Both keys are normalized on the way in, for the reason the current
`normalizeDensity` documents: an unrecognized key emits `--row-step:
undefinedpx`, and one invalid substitution makes every `calc(Npx +
var(--row-step))` compute to `auto`, collapsing the height of every row in the
app at once. A text scale has the same failure mode one step worse, since it
writes ten tokens rather than one.

Settings **export/import** carries `uiSpacing` and `uiTextScale` in place of
`uiDensity`, and an imported payload from an older build migrates through the
same path — an exported file is the same shape as stored state, so the migration
cannot live only in `load()`'s storage branch.

## §2 — Mechanism

### Spacing: almost nothing to build

`DENSITY_STEP_PX` → `SPACING_STEP_PX` with four entries; `applyDensity` →
`applySpacing`; `useDensityStep` → `useSpacingStep`. Every one of the 26
existing `var(--row-step)` style call sites responds with no edit, because they were
written against a variable rather than against the two values it used to hold.
This is the part of the feature that the existing design already paid for.

### Text: the ramp, written from JS

A new `applyTextScale(scale)` writes **the whole resolved `--fs-*` ramp** onto
`:root` as px values, computed from one JS table. It deliberately mirrors
`applySpacing`: JS owns the numbers, and `index.css` declares the ×1 ramp only
as a pre-hydration default so there is no flash of unscaled type before the
store applies.

The rejected alternative was declaring the ramp in CSS as
`--fs-13: calc(13px * var(--ui-text-scale))`. It reads better, but it turns
`--diff-row-h: calc(var(--fs-12) * var(--lh-code))` into a nested `calc()`
inside an *unregistered* custom property, and `readDiffRowHeight` already
carries a fallback for exactly the case where that value does not resolve to px
("notably jsdom, which does not evaluate calc()"). Writing resolved px keeps
`--diff-row-h` a one-level calc, unchanged, and keeps the resolution question
from ever arising in the webview.

Values are rounded to one decimal (`Math.round(px * 10) / 10`). Not to whole
pixels: two adjacent steps of the ramp are 1px apart at the small end, and
rounding ×0.92 or ×1.15 to integers can collapse or reorder them.

| token | ×0.92 | ×1 | ×1.15 | ×1.3 |
|---|---|---|---|---|
| `--fs-10` | 9.2 | 10 | 11.5 | 13 |
| `--fs-11` | 10.1 | 11 | 12.7 | 14.3 |
| `--fs-12` | 11 | 12 | 13.8 | 15.6 |
| `--fs-13` | 12 | 13 | 15 | 16.9 |
| `--fs-14` | 12.9 | 14 | 16.1 | 18.2 |
| `--fs-15` | 13.8 | 15 | 17.3 | 19.5 |
| `--fs-17` | 15.6 | 17 | 19.6 | 22.1 |
| `--fs-20` | 18.4 | 20 | 23 | 26 |
| `--fs-28` | 25.8 | 28 | 32.2 | 36.4 |
| `--fs-40` | 36.8 | 40 | 46 | 52 |

### Text: the row bases

The 26 row surfaces set `height:`, not `min-height:`. At ×1.3 a 13px label
becomes 16.9px, whose line box at `--lh-body` is 24.5px — taller than the 22px
and 24px row bases in use. Text clips unless the bases scale too.

`applyTextScale` therefore also writes `--row-scale` (the raw factor), and those
call sites become:

```
calc(<base>px * var(--row-scale) + var(--row-step))
calc(<base>px * var(--row-scale) + var(--row-step) / 2)   /* padding */
```

`grep -rn 'var(--row-step)' src/` still enumerates every participant, so the
discovery mechanism `index.css` documents survives unchanged — as does the note
that Settings' rows take the step from `densityPadding()` / `SETTINGS_ROW_PADDING`
in `SettingsCard.tsx` rather than inline, and must be included in that grep.

Two alternatives were rejected:

- **Folding text scale into `--row-step`** (one additive number for both). A
  48px pull-request row and a 22px chip need different *absolute* growth for
  the same proportional change; a single additive step over-grows the short row
  and under-grows the tall one. It also destroys the meaning of
  `useSpacingStep`, which several surfaces read as a number.
- **Switching the rows to `min-height`**, letting them grow on their own. Self
  correcting and arithmetic-free, but History, DiffViewer, Branches and
  RepoBrowser are windowed: a row whose height the window cannot predict
  desyncs the window from the rows it is measuring. That is the #70 lesson, and
  applying `min-height` only to the unwindowed surfaces would leave two rules
  where there is currently one.

## §3 — The JS geometry that must follow the text scale

Three places restate geometry in TypeScript and will not move on their own.

**1. `lib/useDiffRowHeight.ts`.** It re-reads `--diff-row-h` when
`useDensityStep()` changes. But `--diff-row-h` is derived from `--fs-12`, so it
moves with *text*, not with spacing — today's dependency is the one axis that
cannot change it. It takes the text scale as a dependency; keeping the spacing
dep as well is harmless and cheap.

**2. `design/graph-geometry.ts`.** `SHA_COL_W = 70` is documented as "seven hex
digits of monospace, plus the gap"; `DATE_COL_W` is sized to a rendered date
string. At ×1.3 both columns are narrower than the text they exist to hold, and
a fixed column that cannot fit its content truncates a sha or a timestamp —
values where truncation destroys the meaning. They become functions of the
scale:

```
shaColW(s)          = 70 * s
dateColW(fmt, s)    = DATE_COL_W[fmt] * s
subjectMinW(s)      = 140 * s
authorMinW(s)       = 16 + 6 + COL_PAD * s      // avatar and gap are not type
colPad(s)           = 10 * s
commitListMinW(s)   = ceil(graphWidth(4) + shaColW(s) + subjectMinW(s)
                           + authorMinW(s) + dateColW("relative", s))
```

`graphWidth` is not scaled: lanes are dots and strokes in SVG user units, and
under §4 they belong to row height, not to type. The avatar's 16px and the 6px
flex gap after it are likewise not type.

Scaling `COMMIT_LIST_MIN_W` with the columns it is the sum of is what keeps the
yield order intact at every preset: a floor that stayed at 420 while the columns
grew would push the Date column off the right edge at Large, which is precisely
the failure `git-components.narrow.test.tsx` exists to prevent.

**3. `design/git-components.tsx`.** `ROW_H` (the JS twin of `--row-h`) and the
number `PGCommitRow` feeds `PGGraphRow`, which draws in SVG user units and
cannot read the CSS token. Both take the scale.

## §4 — Scope boundary

Text size moves **type, row bases, and text-derived column widths**. It does
**not** scale icons, borders, strokes, shadows, gaps or graph lanes. Zoom is the
control that scales those, and the two composing is the reason all three knobs
exist. A user at Larger text with 16px icons has slightly small icons; a user
who wants everything bigger has Zoom, one row up in the same card.

Also explicitly out of scope: the dead `--s-1` … `--s-8` spacing tokens in
`index.css`. They are declared and used at **zero** sites — every padding and
gap in the app is a hardcoded inline literal — so "global spacing" cannot mean
"scale the spacing tokens". It means the row-step mechanism, widened. Reviving
the spacing scale across the codebase is a separate, much larger change and this
spec does not start it.

## §5 — The Appearance page

`appearance.density` is replaced by two rows in the same card, placed together
and immediately above `appearance.zoom` so the three size controls read as a
group:

- **Text size** — `PGButtonGroup`, four options — the control every other small
  enum in this card uses (follow-mode, the retired density row, Date format);
  `stacked` is the fallback if four options overflow, never a native select.
  Hint names what it does *not* do,
  so the difference from Zoom is on screen rather than inferred: text only,
  chrome unchanged.
- **Spacing** — `PGButtonGroup`, four options. Hint states the per-row pixel
  delta,
  read from `SPACING_STEP_PX` rather than written as a literal, the way the
  current hint reads `DENSITY_STEP_PX.comfortable`.

`meta.cards[].rows` gains both ids. Settings is a registry: a row absent from
`meta` fails `settings.index.test.tsx`, and a word that lives only in a `hint`
is not indexed. Keywords therefore retain **density, compact, cozy, comfortable,
spacious, row height, spacing** on the spacing row and **font size, text, type,
bigger, smaller, larger, readable, accessibility** on the text row — so a user
searching the word this build no longer displays still lands on its replacement.

## §6 — Invariants, each a guard test

The presets are a finite set, which is the point of making them presets: every
property below can be asserted across all four rather than sampled.

1. **The ramp stays strictly ascending at every text preset.** The rounding
   step is what could break it, and a collapsed or reordered pair would make two
   different type roles render identically with nothing on screen saying why.
2. **Every row base clears its own line box at every text preset** — for the
   smallest base in use (22px) against `--fs-13 × --lh-body`. This is the
   clipping guard, and it is the assertion that would have failed had we scaled
   the ramp without scaling the bases.
3. **Sum of column minimums ≤ `commitListMinW(s)` at every text preset**,
   extending `git-components.narrow.test.tsx`. Since `commitListMinW` is defined
   as that sum, the test must re-derive the sum from `commitRowGrid`'s own
   template rather than from the same expression, or it asserts nothing — what
   it is there to catch is a *new* fixed column added to the grid and not to the
   formula.
4. **Migration:** `uiDensity: "comfortable"` → `uiSpacing: "comfortable"`;
   `uiDensity: "compact"` → `uiSpacing: "cozy"`; a stored `uiSpacing` wins over
   a stale `uiDensity`; an unknown value in either key falls back to its
   default rather than emitting `undefinedpx`.
5. **`useDiffRowHeight` re-reads on a text-scale change** — the dependency that
   is wrong today.
6. **Export/import round-trips both keys**, and an exported payload carrying
   the old `uiDensity` migrates on import.

Existing tests to update: `git-components.density.test.tsx` (renamed to cover
both axes), `git-components.narrow.test.tsx`, `Settings.appearance.test.tsx`,
`useSettingsStore.test.ts`, `useSettingsStore.export.test.ts`,
`SettingsCard.test.tsx`, `skeleton.test.tsx`, and `e2e/specs/settings.e2e.ts`.

## §7 — Documentation

- `index.css` — the `===== DENSITY =====` comment block is the written
  contract for `--row-step`. It becomes the contract for `--row-step` *and*
  `--row-scale`, including the `* var(--row-scale)` call-site form and the
  unchanged grep.
- `docs/dev/frontend.md` — the density section gains the text scale, the three
  JS geometries of §3, and the §4 boundary against Zoom.
- `CLAUDE.md` — the design-system bullet currently says new list-row surfaces
  opt into UI density (`var(--row-step)`); it must name both vars.
- Changelog — this is the rare change that moves an existing user's pixels
  without being asked, so it needs an entry that says so and names the control
  that reverses it.
