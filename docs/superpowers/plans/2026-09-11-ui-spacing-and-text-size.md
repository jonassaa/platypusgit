# Global spacing + text size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary `uiDensity` setting with two independent presets — **Spacing** (four row-step values) and **Text size** (four type-ramp scales) — so a user can loosen the layout, enlarge the type, or both, without touching the whole-UI Zoom.

**Architecture:** Two persisted enums in `useSettingsStore`, each with a `TABLE → normalize → apply` trio that writes CSS custom properties on `:root`, exactly mirroring the existing `DENSITY_STEP_PX → normalizeDensity → applyDensity`. Spacing keeps writing `--row-step`; text writes the resolved `--fs-*` ramp plus a unitless `--row-scale` that the 26 existing row call sites multiply their base by. Three places restate this geometry in TypeScript (diff row pitch, commit-row column widths, SVG graph gutter) and are taught to read the scale.

**Tech Stack:** React 19 + TypeScript, Zustand, vitest (projects `unit` jsdom / `docs` node), WebdriverIO e2e, Tauri 2 webview.

**Spec:** `docs/superpowers/specs/2026-09-11-ui-spacing-and-text-size-design.md`

## Global Constraints

- **Toolchain.** `~/Library/pnpm/pnpm` and `~/.cargo/bin/cargo` by absolute path — the Bash tool does not inherit the interactive shell rc, and in a worktree-isolated session the `export PATH=…` line from `CLAUDE.md` is refused.
- **Work only in this worktree**, `.claude/worktrees/ui-scale`, branch `feat/ui-scale`. Never commit to `main`.
- **No native `<select>`/`<option>`** in shipped `src/` — a guard test fails the build. Appearance uses `PGButtonGroup` for every small enum; both new controls follow it.
- **Settings is a registry.** A new setting MUST join its page's `meta.cards[].rows` or `settings.index.test.tsx` fails the build. A word that lives only in a `hint` is NOT indexed — it goes in `keywords`.
- **Never hardcode a pixel the tables own.** `SPACING_STEP_PX` and `TEXT_SCALE` are the source of truth; CSS declares only pre-hydration defaults, and hints read the tables rather than spelling numbers.
- **Commit style:** `feat(scope): …` / `fix(scope): …` / `test: …` / `docs: …`, imperative subject under 72 chars, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` as the last line. Write every message as public prose — the squash quotes all of them into the body.
- **Backticks in a `git commit -m` body hang the Bash tool** (the command is eval'd, so `` `x` `` runs `x` and blocks on stdin). Use `-m` with no backticks, or `-F <file>`.
- **Run the unit suite with** `~/Library/pnpm/pnpm vitest run --project unit <path>` and the guard suite with `--project docs`. Type-check with `~/Library/pnpm/pnpm tsc --noEmit`.
- **E2E only at the end, only in Docker**, and only the one spec this change touches.

### The two tables, verbatim — every task refers to these

```ts
export const SPACING_STEP_PX = {
  compact: 0,
  cozy: 2,
  comfortable: 4,
  spacious: 8,
} as const;

export const TEXT_SCALE = {
  small: 0.92,
  default: 1,
  large: 1.15,
  larger: 1.3,
} as const;
```

Defaults: `uiSpacing: "cozy"`, `uiTextScale: "default"`.

---

## File Structure

**Modified — the store (the owner of both settings):**
- `src/features/settings/useSettingsStore.ts` — both tables, both normalizers, both appliers, the persisted keys, the `coerceSettings` migration, and the `useSpacingStep` / `useTextScale` / `useRowH` hooks.

**Modified — CSS contract:**
- `src/index.css` — `--row-scale: 1` beside `--row-step: 0px`, and the `===== DENSITY =====` comment block becomes the contract for both.

**Modified — the 26 row call sites** (mechanical, one regex): `src/design/primitives.tsx`, `src/design/chrome.tsx`, `src/design/git-components.tsx`, `src/features/settings/layout/SettingsCard.tsx`, `src/features/diff/CommitDiffPanel.tsx`, `src/features/forge/PullRequestRow.tsx`, `src/features/compare/CompareSidePicker.tsx`, `src/features/branches/BranchPicker.tsx`, `src/features/rebase/RebaseBasePicker.tsx`, `src/features/palette/CommandPalette.tsx`, `src/screens/History.tsx`, `src/screens/FileHistory.tsx`, `src/screens/DiffViewer.tsx`, `src/screens/Compare.tsx`, `src/screens/Welcome.tsx`, `src/screens/Branches.tsx`.

**Modified — the JS geometry that CSS cannot reach:**
- `src/lib/useDiffRowHeight.ts` — re-read dependency.
- `src/design/graph-geometry.ts` — column widths become functions of the scale.
- `src/design/git-components.tsx` — `PGCommitRow` / `PGGraphRow`, `commitRowGrid` caller.
- `src/screens/History.tsx` — header grid + `siblingMin`.
- `src/screens/RepoBrowser.tsx`, `src/screens/CommitPanel.tsx`, `src/screens/DiffViewer.tsx` — windowed row pitches.

**Modified — UI:**
- `src/features/settings/pages/appearance.tsx` — `meta` rows and the two controls.

**Created:**
- `test/uiScale.test.ts` — guard (project `docs`): no row surface may opt into `--row-step` without `--row-scale`.

**Modified — tests:** `src/design/git-components.density.test.tsx` (renamed), `src/design/git-components.narrow.test.tsx`, `src/features/settings/useSettingsStore.test.ts`, `src/features/settings/useSettingsStore.export.test.ts`, `src/features/settings/themeFiles.test.ts`, `src/features/settings/layout/SettingsCard.test.tsx`, `src/screens/Settings.appearance.test.tsx`, `e2e/specs/settings.e2e.ts`.

**Modified — docs:** `src/index.css` comment, `docs/dev/frontend.md`, `CLAUDE.md`.

### Trap: two existing tests use `"cozy"` as their example of an INVALID value

`"cozy"` becomes a real spacing value in Task 1, so these two stop testing what they say:

- `src/features/settings/useSettingsStore.test.ts:427` — stores `{ uiDensity: "cozy" }` and expects the fallback.
- `src/features/settings/useSettingsStore.export.test.ts:492` — imports `uiDensity: "cozy"` and expects `"compact"`.

Both must switch to a value that is genuinely not in the table. Use `"roomy"`. Task 1 does this; do not skip it, and do not "fix" the resulting failure by re-adding `cozy` as invalid.

---

### Task 1: Spacing — widen the step table, rename the axis, migrate

**Files:**
- Modify: `src/features/settings/useSettingsStore.ts` (lines ~666–730, 835, 1094, ~1455, ~1507, 2003, 2031, 2047, 2058, 2089)
- Modify: `src/design/git-components.tsx:18,1630`, `src/screens/RepoBrowser.tsx:35,366,718`, `src/screens/CommitPanel.tsx:42,643`, `src/screens/DiffViewer.tsx:63,239`, `src/screens/History.tsx:51,318`, `src/lib/useDiffRowHeight.ts:2,30`
- Test: `src/features/settings/useSettingsStore.test.ts`, `src/features/settings/useSettingsStore.export.test.ts`, `src/features/settings/themeFiles.test.ts`, `src/design/git-components.density.test.tsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `export const SPACING_STEP_PX: { compact: 0; cozy: 2; comfortable: 4; spacious: 8 }`
  - `export type UiSpacing = keyof typeof SPACING_STEP_PX`
  - `export function applySpacing(spacing: UiSpacing): void`
  - `export function useSpacingStep(): number`
  - `PersistedState.uiSpacing: UiSpacing`
  - `DENSITY_STEP_PX`, `UiDensity`, `applyDensity`, `useDensityStep` no longer exist.

- [ ] **Step 1: Write the failing tests**

In `src/features/settings/useSettingsStore.test.ts`, replace the whole `describe("uiDensity CSS hook", …)` block (lines ~387–430) with:

```ts
describe("uiSpacing CSS hook", () => {
  it("applies --row-step from the persisted spacing at load", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiSpacing: "spacious" }));
    await freshStore();
    expect(rowStep()).toBe("8px");
  });

  it("re-applies --row-step when the spacing setting changes", async () => {
    await freshStore();
    useSettingsStore.getState().set("uiSpacing", "comfortable");
    expect(rowStep()).toBe("4px");
    useSettingsStore.getState().set("uiSpacing", "compact");
    expect(rowStep()).toBe("0px");
  });

  // Compact must stay exactly 0: it is the value that reproduces the
  // pre-density layout, so every `calc(Npx + var(--row-step))` collapses to Npx.
  it("keeps compact at zero and orders the four steps", async () => {
    const { SPACING_STEP_PX } = await freshStore();
    expect(SPACING_STEP_PX.compact).toBe(0);
    expect(Object.values(SPACING_STEP_PX)).toEqual([0, 2, 4, 8]);
  });

  // An unrecognized value would emit `--row-step: undefinedpx`, and one
  // invalid substitution makes every `calc(Npx + var(--row-step))` compute to
  // `auto` — collapsing the height of every row in the app at once.
  it("falls back to the default for an unknown stored spacing", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiSpacing: "roomy" }));
    await freshStore();
    expect(rowStep()).toBe("2px");
  });

  // `in` walks the prototype chain, so a hand-edited "toString" would pass a
  // membership check and index the table to a FUNCTION — the same undefinedpx
  // collapse, reached by a value that looks like it was validated.
  it("rejects an inherited Object property as a spacing value", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiSpacing: "toString" }));
    await freshStore();
    expect(rowStep()).toBe("2px");
  });
});

describe("uiDensity migration", () => {
  it("carries a stored comfortable density over to comfortable spacing", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiDensity: "comfortable" }));
    await freshStore();
    expect(useSettingsStore.getState().uiSpacing).toBe("comfortable");
    expect(rowStep()).toBe("4px");
  });

  // Deliberate: a stored "compact" cannot be told apart from "never touched
  // it", and the whole point of the change is that the old default was too
  // dense. Landing an upgraded install on cozy is the same call the
  // headIndicator -> headMarks migration made one setting over.
  it("lands an upgraded compact install on cozy", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiDensity: "compact" }));
    await freshStore();
    expect(useSettingsStore.getState().uiSpacing).toBe("cozy");
  });

  it("lets a stored uiSpacing win over a stale uiDensity", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ uiDensity: "comfortable", uiSpacing: "compact" }),
    );
    await freshStore();
    expect(useSettingsStore.getState().uiSpacing).toBe("compact");
  });

  it("drops the retired key from state", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiDensity: "comfortable" }));
    await freshStore();
    expect("uiDensity" in useSettingsStore.getState()).toBe(false);
  });
});
```

Add the `rowStep()` helper next to the existing one at line ~330 if it is not already a named function:

```ts
const rowStep = () =>
  document.documentElement.style.getPropertyValue("--row-step");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings/useSettingsStore.test.ts`
Expected: FAIL — `SPACING_STEP_PX` is not exported, and `uiSpacing` is not a key.

- [ ] **Step 3: Replace the table, the normalizer and the applier**

In `src/features/settings/useSettingsStore.ts`, replace `DENSITY_STEP_PX` / `UiDensity` / `normalizeDensity` / `applyDensity` (lines ~666–727) with:

```ts
/**
 * Extra vertical pixels each row-ish surface adds, per spacing preset.
 *
 * THE source of truth for the number. `index.css` declares `--row-step: 0px`
 * as a pre-hydration default and derives every row token from it
 * (`--row-h: calc(24px * var(--row-scale) + var(--row-step))`, …);
 * `applySpacing` overwrites the var from this table, so CSS never hardcodes a
 * step and cannot drift from the JS one. Compact is 0 by definition — it is
 * the value that reproduces the pre-density layout exactly.
 */
export const SPACING_STEP_PX = {
  compact: 0,
  cozy: 2,
  comfortable: 4,
  spacious: 8,
} as const;

export type UiSpacing = keyof typeof SPACING_STEP_PX;

/**
 * Coerce a persisted spacing into a known one.
 *
 * `coerceSettings` copies any JSON value for a known key and only type-guards
 * it against the TYPE of its default, so state can hold a string this build
 * has never heard of — a hand-edited `pg-settings-v2`, or a value written by a
 * newer build the user downgraded from. That must degrade to the default: an
 * unknown key would emit `--row-step: undefinedpx`, and one invalid
 * substitution makes every `calc(Npx + var(--row-step))` compute to `auto`,
 * collapsing the height of every row in the app at once.
 *
 * `Object.hasOwn`, not `in`: `in` walks the prototype chain, so "toString"
 * would pass the check and then index the table to a FUNCTION — the same
 * collapse, reached by a value that looked validated.
 */
function normalizeSpacing(spacing: unknown): UiSpacing {
  return typeof spacing === "string" && Object.hasOwn(SPACING_STEP_PX, spacing)
    ? (spacing as UiSpacing)
    : DEFAULTS.uiSpacing;
}

/**
 * Apply the spacing preset by writing the row-step slot to CSS vars on :root.
 *
 * `data-spacing` is also set — a reserved hook for any future rule that isn't
 * a simple pixel delta. Nothing reads it today (it's asserted only in
 * useSettingsStore.test.ts); drop it if that stays true.
 */
export function applySpacing(spacing: UiSpacing) {
  const root = document.documentElement;
  const s = normalizeSpacing(spacing);
  root.style.setProperty("--row-step", `${SPACING_STEP_PX[s]}px`);
  root.dataset.spacing = s;
}
```

`normalizeSpacing` reads `DEFAULTS`, which is declared later in the file. That is fine — it is only ever *called* after module evaluation, the same way the existing normalizers reference `DEFAULTS.dateFormat`.

- [ ] **Step 4: Swap the persisted key**

`src/features/settings/useSettingsStore.ts:835` — replace `uiDensity: "compact" | "comfortable";` with:

```ts
  /**
   * How much breathing room every list row gets (`--row-step`). Replaces the
   * binary `uiDensity`; `coerceSettings` migrates the old key.
   */
  uiSpacing: UiSpacing;
```

`:1094` — replace `uiDensity: "compact",` with `uiSpacing: "cozy",`.

- [ ] **Step 5: Migrate in `coerceSettings`, the ONE place both paths pass through**

`load()` calls `coerceSettings(parsed, DEFAULTS).state` and `importSettings` calls it too, so the migration written here covers storage AND an imported settings file. Nothing extra is needed in either caller.

At `:1455`, extend the `ignored` exemption so the retired key is honoured rather than reported:

```ts
  const ignored = Object.keys(parsed).filter(
    // `headIndicator` and `uiDensity` left the schema but the migrations below
    // still read them, so they are honoured rather than ignored.
    (k) => !known.has(k) && k !== "headIndicator" && k !== "uiDensity",
  );
```

At `:1507`, replace the `out.uiDensity = normalizeDensity(out.uiDensity);` line with:

```ts
  // Spacing (#457-era rename). A stored `uiSpacing` wins; otherwise the
  // pre-rename `uiDensity` is carried over, reading `parsed` rather than `out`
  // because the old key is gone from the schema and the copy loop above never
  // picked it up.
  //
  // `compact` deliberately lands on `cozy` rather than on `compact`: a stored
  // "compact" cannot be distinguished from "never touched it" — `load()` fills
  // missing keys from DEFAULTS and writes the result back — so preserving it
  // would ship the roomier default to new installs only. Two pixels per row is
  // mild and one click reversible, and it is the same call the headIndicator
  // migration below makes one setting over.
  if (!("uiSpacing" in parsed)) {
    out.uiSpacing =
      parsed.uiDensity === "comfortable"
        ? "comfortable"
        : parsed.uiDensity === "compact"
          ? "cozy"
          : DEFAULTS.uiSpacing;
  }
  out.uiSpacing = normalizeSpacing(out.uiSpacing);
```

- [ ] **Step 6: Repoint the four appliers and the hook**

In the same file:
- `:2003` (inside `importSettings`) — `applyDensity(state.uiDensity);` → `applySpacing(state.uiSpacing);`
- `:2031` — `if (key === "uiDensity") { applyDensity(get().uiDensity); }` → `if (key === "uiSpacing") { applySpacing(get().uiSpacing); }`
- `:2047` (inside `reset`) — `applyDensity(DEFAULTS.uiDensity);` → `applySpacing(DEFAULTS.uiSpacing);`
- `:2058` (module load) — `applyDensity(s.uiDensity);` → `applySpacing(s.uiSpacing);`
- `:2089` — replace `useDensityStep` with:

```ts
/**
 * The active spacing preset's pixel step, for surfaces that need the NUMBER
 * rather than the `--row-step` CSS var — i.e. anything doing geometry math in
 * JS. Prefer the CSS token everywhere it works; this exists for SVG user-unit
 * drawing (see `PGGraphRow`) and for windowed lists, neither of which a
 * `calc()` can reach.
 */
export function useSpacingStep(): number {
  return SPACING_STEP_PX[normalizeSpacing(useSettingsStore((s) => s.uiSpacing))];
}
```

- [ ] **Step 7: Rename the six consumers**

Mechanical — each is an import plus a call:

```bash
cd /Users/jonas/dev/fun/platypusgit/.claude/worktrees/ui-scale
grep -rl "useDensityStep" src/ | xargs sed -i '' 's/useDensityStep/useSpacingStep/g'
grep -rn "useDensityStep\|applyDensity\|DENSITY_STEP_PX\|uiDensity" src/ | grep -v "\.test\."
```

The second command must print NOTHING except the migration comment in `useSettingsStore.ts`. Fix anything else it finds.

- [ ] **Step 8: Update the tests that used the old key**

- `src/design/git-components.density.test.tsx` — `set("uiDensity", "compact")` → `set("uiSpacing", "compact")` at lines 39, and `set("uiDensity", "comfortable")` → `set("uiSpacing", "comfortable")` at 53 and 68. The asserted heights (26 and 30) are unchanged, because compact is still 0 and comfortable still 4.
- `src/features/settings/themeFiles.test.ts:103,110` — the fixture `'{"settings":{"uiDensity":"comfortable"}}'` now MIGRATES rather than being ignored. Change the fixture to `'{"settings":{"uiSpacing":"comfortable"}}'` and line 110 to `expect(useSettingsStore.getState().uiSpacing).toBe("compact")` if the test asserts a denied import, or `toBe("comfortable")` if it asserts an accepted one — read the surrounding `it(…)` title and keep its meaning.
- `src/features/settings/useSettingsStore.export.test.ts:97` — `"uiDensity"` → `"uiSpacing"` in the portable-key list.
- `…export.test.ts:273` — `set("uiDensity", "comfortable")` → `set("uiSpacing", "comfortable")`.
- `…export.test.ts:492,499` — **the "cozy" trap.** `uiDensity: "cozy"` was this test's example of an invalid value and `cozy` is now valid. Change the payload to `{ uiSpacing: "roomy" }` and the expectation to `expect(s.uiSpacing).toBe("cozy")` — the default.
- `src/features/settings/useSettingsStore.test.ts:16` — the `--row-step` cleanup stays as is.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings src/design/git-components.density.test.tsx`
Expected: PASS. Then `~/Library/pnpm/pnpm tsc --noEmit` — expected: clean.

- [ ] **Step 10: Commit**

```bash
cd /Users/jonas/dev/fun/platypusgit/.claude/worktrees/ui-scale
git add -A
git commit -m "feat(settings): four spacing presets in place of binary density" -m "Widens DENSITY_STEP_PX into SPACING_STEP_PX (0/2/4/8px) and renames the
axis to uiSpacing, migrating the retired uiDensity key in coerceSettings --
the one function both localStorage load and settings import pass through.

An upgraded install on compact deliberately lands on cozy: a stored
compact cannot be distinguished from never having touched the setting,
so preserving it would ship the roomier default to new installs only.

Also hardens the membership check to Object.hasOwn. The old 'in' walked
the prototype chain, so a hand-edited value of toString passed validation
and then indexed the table to a function -- emitting undefinedpx, which
collapses the height of every row in the app at once.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Text scale — the ramp and `--row-scale`, written from JS

**Files:**
- Modify: `src/features/settings/useSettingsStore.ts`
- Test: `src/features/settings/useSettingsStore.test.ts`

**Interfaces:**
- Consumes: `normalizeSpacing`, `applySpacing`, `DEFAULTS` (Task 1).
- Produces:
  - `export const FS_TOKENS: readonly [10,11,12,13,14,15,17,20,28,40]`
  - `export const TEXT_SCALE: { small: 0.92; default: 1; large: 1.15; larger: 1.3 }`
  - `export type UiTextScale = keyof typeof TEXT_SCALE`
  - `export function applyTextScale(scale: UiTextScale): void`
  - `export function useTextScale(): number` — the raw factor (0.92 … 1.3), not the key
  - `PersistedState.uiTextScale: UiTextScale`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/settings/useSettingsStore.test.ts`:

```ts
const fsVar = (n: number) =>
  document.documentElement.style.getPropertyValue(`--fs-${n}`);
const rowScale = () =>
  document.documentElement.style.getPropertyValue("--row-scale");

describe("uiTextScale CSS hook", () => {
  it("applies the resolved ramp from the persisted scale at load", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiTextScale: "larger" }));
    await freshStore();
    expect(fsVar(13)).toBe("16.9px");
    expect(fsVar(40)).toBe("52px");
    expect(rowScale()).toBe("1.3");
  });

  it("re-applies the ramp when the setting changes", async () => {
    await freshStore();
    expect(fsVar(13)).toBe("13px");
    useSettingsStore.getState().set("uiTextScale", "large");
    expect(fsVar(13)).toBe("15px");
    expect(rowScale()).toBe("1.15");
  });

  // Rounding is what could break this, and a collapsed or reordered pair would
  // render two different type roles identically with nothing on screen saying
  // why. Four presets is a finite set, so assert it rather than sample it.
  it("keeps the ramp strictly ascending at every preset", async () => {
    const { TEXT_SCALE, FS_TOKENS, applyTextScale } = await freshStore();
    for (const key of Object.keys(TEXT_SCALE) as (keyof typeof TEXT_SCALE)[]) {
      applyTextScale(key);
      const sizes = FS_TOKENS.map((n) => Number.parseFloat(fsVar(n)));
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i], `${key}: --fs-${FS_TOKENS[i]}`).toBeGreaterThan(sizes[i - 1]);
      }
    }
  });

  // The clipping guard. Rows set `height`, not `min-height`, so a base that
  // does not grow with the type clips it -- and no test that only reads the
  // ramp can see that. --fs-13 x --lh-body must fit the SMALLEST row base in
  // use (22px, PGBranchRow and the Compare header).
  it("keeps the smallest row base clear of its own line box at every preset", async () => {
    const { TEXT_SCALE, applyTextScale } = await freshStore();
    const SMALLEST_ROW_BASE = 22;
    const LH_BODY = 1.45;
    for (const key of Object.keys(TEXT_SCALE) as (keyof typeof TEXT_SCALE)[]) {
      applyTextScale(key);
      const lineBox = Number.parseFloat(fsVar(13)) * LH_BODY;
      const rowH = SMALLEST_ROW_BASE * Number.parseFloat(rowScale());
      expect(rowH, `${key}`).toBeGreaterThanOrEqual(lineBox);
    }
  });

  it("falls back to the default for an unknown stored text scale", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiTextScale: "huge" }));
    await freshStore();
    expect(fsVar(13)).toBe("13px");
    expect(rowScale()).toBe("1");
  });

  it("rejects an inherited Object property as a text scale", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiTextScale: "toString" }));
    await freshStore();
    expect(rowScale()).toBe("1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings/useSettingsStore.test.ts`
Expected: FAIL — `TEXT_SCALE` is not exported.

- [ ] **Step 3: Add the table, the normalizer and the applier**

In `src/features/settings/useSettingsStore.ts`, immediately after `applySpacing`:

```ts
/**
 * Every step of the type ramp, as the NUMBER in its token name.
 *
 * `index.css` declares `--fs-10` … `--fs-40` at these exact px values as the
 * pre-hydration default; `applyTextScale` overwrites all ten from this list,
 * so the two cannot drift and a new step is added in one place.
 */
export const FS_TOKENS = [10, 11, 12, 13, 14, 15, 17, 20, 28, 40] as const;

/**
 * How far the type ramp moves, per text-size preset.
 *
 * Text size is NOT zoom. Zoom scales the whole UI through the webview —
 * borders, icons, the titlebar, whitespace — and is the answer to "this app is
 * too small on my display". This scales type, the row bases that have to hold
 * it, and the column widths that are sized to text; icons and gaps stay put.
 * The two compose, which is why both exist.
 */
export const TEXT_SCALE = {
  small: 0.92,
  default: 1,
  large: 1.15,
  larger: 1.3,
} as const;

export type UiTextScale = keyof typeof TEXT_SCALE;

/** Same contract as `normalizeSpacing`, one setting over — see its comment. */
function normalizeTextScale(scale: unknown): UiTextScale {
  return typeof scale === "string" && Object.hasOwn(TEXT_SCALE, scale)
    ? (scale as UiTextScale)
    : DEFAULTS.uiTextScale;
}

/**
 * Apply the text-size preset by writing the RESOLVED ramp to :root.
 *
 * Resolved px rather than `--fs-13: calc(13px * var(--ui-text-scale))`, which
 * reads better but would make `--diff-row-h: calc(var(--fs-12) *
 * var(--lh-code))` a nested calc() inside an unregistered custom property —
 * and `readDiffRowHeight` already carries a fallback for the case where that
 * value does not resolve to px. Writing px keeps `--diff-row-h` a one-level
 * calc, unchanged, and keeps the question from arising in the webview at all.
 *
 * One decimal, not whole pixels: two steps of the ramp are 1px apart at the
 * small end, and integer rounding can collapse or reorder them.
 *
 * `--row-scale` is the same factor, unitless, for the row bases — every row
 * surface sets `height`, not `min-height`, so a base that does not grow with
 * the type clips it.
 */
export function applyTextScale(scale: UiTextScale) {
  const root = document.documentElement;
  const key = normalizeTextScale(scale);
  const f = TEXT_SCALE[key];
  for (const base of FS_TOKENS) {
    root.style.setProperty(`--fs-${base}`, `${Math.round(base * f * 10) / 10}px`);
  }
  root.style.setProperty("--row-scale", String(f));
  root.dataset.textScale = key;
}
```

- [ ] **Step 4: Add the persisted key and wire the four appliers**

- `PersistedState`, directly under `uiSpacing`:

```ts
  /**
   * How large the type is (`--fs-*`) and, with it, the row bases and the
   * text-sized columns. Independent of `uiZoom`, which scales everything.
   */
  uiTextScale: UiTextScale;
```

- `DEFAULTS`, under `uiSpacing: "cozy",` — add `uiTextScale: "default",`.
- In `coerceSettings`, directly after the `out.uiSpacing = normalizeSpacing(…)` line — add `out.uiTextScale = normalizeTextScale(out.uiTextScale);`
- `importSettings` — add `applyTextScale(state.uiTextScale);` beside `applySpacing(state.uiSpacing);`
- `set()` — add beside the `uiSpacing` arm:

```ts
    if (key === "uiTextScale") {
      applyTextScale(get().uiTextScale);
    }
```

- `reset()` — add `applyTextScale(DEFAULTS.uiTextScale);`
- module-load block — add `applyTextScale(s.uiTextScale);`, and update its comment to "Apply active theme, spacing and text scale on module load so there's no flash before first render."

- [ ] **Step 5: Add the hook**

Beside `useSpacingStep`:

```ts
/**
 * The active text scale as a FACTOR (0.92 … 1.3), for surfaces that multiply a
 * JS pixel constant by it — windowed row pitches, the SVG graph gutter, and
 * the commit row's text-sized columns. Everything a `calc()` can reach should
 * use `var(--row-scale)` instead.
 */
export function useTextScale(): number {
  return TEXT_SCALE[normalizeTextScale(useSettingsStore((s) => s.uiTextScale))];
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings/useSettingsStore.test.ts`
Expected: PASS, including the ascending-ramp and line-box guards.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): a text-size preset that scales the type ramp" -m "applyTextScale writes all ten --fs-* tokens as resolved px from one JS
table, plus a unitless --row-scale for the row bases. Resolved px rather
than calc(13px * var(--scale)) because the latter would turn --diff-row-h
into a nested calc inside an unregistered custom property, which is
exactly the case readDiffRowHeight already carries a fallback for.

Two guards land with it: the ramp stays strictly ascending at every
preset (rounding is what could break it), and the smallest row base
clears its own line box at every preset -- the assertion that catches
scaling type without scaling the rows that must hold it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The 26 row call sites multiply their base by `--row-scale`

**Files:**
- Modify: `src/index.css:174–195`
- Modify (sweep): `src/design/primitives.tsx`, `src/design/chrome.tsx`, `src/design/git-components.tsx`, `src/features/diff/CommitDiffPanel.tsx`, `src/features/forge/PullRequestRow.tsx`, `src/features/compare/CompareSidePicker.tsx`, `src/features/branches/BranchPicker.tsx`, `src/features/rebase/RebaseBasePicker.tsx`, `src/features/palette/CommandPalette.tsx`, `src/screens/History.tsx`, `src/screens/FileHistory.tsx`, `src/screens/DiffViewer.tsx`, `src/screens/Compare.tsx`, `src/screens/Welcome.tsx`, `src/screens/Branches.tsx`
- Modify: `src/features/settings/layout/SettingsCard.tsx:18–20`
- Create: `test/uiScale.test.ts`
- Test: `src/features/settings/layout/SettingsCard.test.tsx`, `src/screens/Settings.appearance.test.tsx`

**Interfaces:**
- Consumes: `--row-scale`, written by `applyTextScale` (Task 2).
- Produces: `densityPadding(basePx)` returns `` `calc(${basePx}px * var(--row-scale) + var(--row-step) / 2) 16px` ``.

- [ ] **Step 1: Write the failing guard test**

Create `test/uiScale.test.ts` (project `docs`, node env — it reads source files):

```ts
// A row surface that opts into spacing must opt into text size too.
//
// Every one of these sets `height`, not `min-height`, so a base that does not
// grow with the type CLIPS it: at the largest preset --fs-13's line box is
// 24.5px, taller than the 22px and 24px bases in use. The two vars are one
// decision — `--row-step` is the user's spacing preset, `--row-scale` the
// text one — and a surface that takes the first without the second is a row
// that gets roomier but still cuts its own text in half.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(): string[] {
  return globSync("src/**/*.{ts,tsx,css}", { cwd: ROOT })
    .filter((f) => !f.includes(".test."))
    .map((f) => join(ROOT, f));
}

describe("--row-step and --row-scale travel together", () => {
  it("has no row surface that scales with spacing but not with text", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        // `calc(<n>px + var(--row-step)` — a base that never grows with type.
        if (/calc\(\s*\d+px\s*\+\s*var\(--row-step\)/.test(line)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  // The other half: a base multiplied by --row-scale but never given the
  // user's spacing step is a row that ignores the Spacing setting entirely.
  it("has no row surface that scales with text but not with spacing", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (
          /var\(--row-scale\)/.test(line) &&
          !/var\(--row-step\)/.test(line) &&
          !/--row-scale:/.test(line)
        ) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
```

If `globSync` is not available from `node:fs` on this Node version, use the same glob helper the neighbouring guard tests use — read `test/fileSave.test.ts` and copy its file-walking approach rather than adding a dependency.

- [ ] **Step 2: Run it to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project docs test/uiScale.test.ts`
Expected: FAIL — the first test lists ~25 offenders.

- [ ] **Step 3: Sweep the call sites**

One regex covers every inline style and the CSS token. It matches only a literal-px base followed by `+ var(--row-step)`, which is exactly the shape being replaced:

```bash
cd /Users/jonas/dev/fun/platypusgit/.claude/worktrees/ui-scale
grep -rl -- "--row-step" src/ --include="*.tsx" --include="*.css" \
  | grep -v "\.test\." \
  | xargs sed -i '' -E 's/calc\(([0-9]+)px \+ var\(--row-step\)/calc(\1px * var(--row-scale) + var(--row-step)/g'
```

Then the one template literal the regex cannot reach — `src/features/settings/layout/SettingsCard.tsx:18-20`:

```ts
export function densityPadding(basePx: number): string {
  return `calc(${basePx}px * var(--row-scale) + var(--row-step) / 2) 16px`;
}
```

Update that function's doc comment: after the existing `--row-step` paragraph, add

```
 * `--row-scale` multiplies the BASE and not the step: the step is already the
 * user's own number in pixels, while the base is what has to hold the text.
```

- [ ] **Step 4: Verify the sweep is complete**

```bash
grep -rn -- "var(--row-step)" src/ --include="*.tsx" --include="*.css" | grep -v "\.test\." | grep -v "row-scale"
```

Expected: only comment lines (`src/index.css`'s token block, `SettingsCard.tsx`'s doc comment, `skeleton.tsx`'s note that it uses `--row-h` directly). No `height:` or `padding:` line may appear. `skeleton.tsx` needs NO edit — it consumes `--row-h`, which is fixed in Step 5.

- [ ] **Step 5: Update the CSS contract**

`src/index.css` — replace the `/* ===== DENSITY ===== */` comment block and its two declarations (lines ~174–195) with:

```css
  /* ===== ROW GEOMETRY: SPACING + TEXT SIZE =====
   * Two knobs, written from JS (features/settings/useSettingsStore.ts), which
   * is THE source of truth for both numbers — these declarations are only the
   * pre-hydration defaults.
   *
   *   --row-step   the user's Spacing preset, in whole extra pixels per row
   *                (applySpacing, from SPACING_STEP_PX)
   *   --row-scale  the user's Text size preset, unitless (applyTextScale,
   *                from TEXT_SCALE) — the same factor the --fs-* ramp took
   *
   * Row surfaces opt into BOTH:
   *
   *   calc(<base>px * var(--row-scale) + var(--row-step))
   *   calc(<base>px * var(--row-scale) + var(--row-step) / 2)   for padding,
   *                                    since top and bottom each take half
   *
   * The base is multiplied and the step is added, because the step is already
   * the user's own number of pixels while the base is what has to HOLD the
   * text — every row surface sets `height`, not `min-height`, so a base that
   * did not grow with the type would clip it.
   *
   * Keeping each surface's own base inline means compact at x1 renders
   * pixel-identically to the pre-density layout, and
   * `grep -rn 'var(--row-step)' src/` lists every participating surface —
   * EXCEPT the Settings panel, which takes both from one shared helper
   * (`densityPadding()` / `SETTINGS_ROW_PADDING` in features/settings/layout/
   * SettingsCard.tsx) so its row helpers cannot drift apart on height. Add
   * `-e densityPadding -e SETTINGS_ROW_PADDING` to that grep to see them, or
   * the Settings rows, the forge account rows and the Appearance page's theme
   * action strip all read as non-participants.
   *
   * `test/uiScale.test.ts` fails the build for a surface that takes one var
   * without the other.
   *
   * One surface can't use either token: PGGraphRow draws in SVG user units, so
   * PGCommitRow feeds it the numbers via useSpacingStep() + useTextScale(). */
  --row-step: 0px;
  --row-scale: 1;
  --row-h: calc(24px * var(--row-scale) + var(--row-step));
```

- [ ] **Step 6: Update the two tests that assert the exact padding string**

- `src/features/settings/layout/SettingsCard.test.tsx:61-63`:

```ts
    expect(densityPadding(12)).toBe(
      "calc(12px * var(--row-scale) + var(--row-step) / 2) 16px",
    );
    expect(densityPadding(10)).toBe(
      "calc(10px * var(--row-scale) + var(--row-step) / 2) 16px",
    );
    expect(SETTINGS_ROW_PADDING).toBe(densityPadding(12));
```

- `src/screens/Settings.appearance.test.tsx:55,58` assert `densityPadding(10)` and `toContain("var(--row-step) / 2")` — both still hold unchanged, since the first compares against the helper and the second is a substring that survives. Run them; edit only if they fail.
- `src/design/primitives.select.test.tsx:110` asserts `row.style.height` **contains** `var(--row-step)` — still true. No edit.

- [ ] **Step 7: Run the tests to verify they pass**

Run:
```
~/Library/pnpm/pnpm vitest run --project docs test/uiScale.test.ts
~/Library/pnpm/pnpm vitest run --project unit src/design src/features/settings src/screens
~/Library/pnpm/pnpm tsc --noEmit
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(design): row bases grow with the text-size preset" -m "Every row surface sets height, not min-height, so scaling the type ramp
without scaling the bases clips it: at the largest preset --fs-13's line
box is 24.5px against 22px and 24px bases. All 26 call sites now read
calc(<base>px * var(--row-scale) + var(--row-step)).

min-height would have been self-correcting and arithmetic-free, but
History, DiffViewer, Branches and RepoBrowser are windowed -- a row whose
height the window cannot predict desyncs the window from the rows it is
measuring, which is the #70 lesson.

test/uiScale.test.ts fails the build for a surface that takes one var
without the other, in either direction.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The JS row pitches get one owner

Six surfaces compute a windowed row pitch as `BASE + useSpacingStep()`. Each now also needs `* useTextScale()`, and six copies of that arithmetic is six chances to write it differently. One hook owns it.

**Files:**
- Modify: `src/features/settings/useSettingsStore.ts` (add `useRowH`)
- Modify: `src/lib/useDiffRowHeight.ts:2,30`
- Modify: `src/design/git-components.tsx:268-273,1630,1635`
- Modify: `src/screens/RepoBrowser.tsx:366,718`, `src/screens/CommitPanel.tsx:643`, `src/screens/DiffViewer.tsx:239`, `src/screens/History.tsx:318`
- Test: `src/design/git-components.density.test.tsx` → renamed `git-components.scale.test.tsx`

**Interfaces:**
- Consumes: `useSpacingStep()` (Task 1), `useTextScale()` (Task 2).
- Produces: `export function useRowH(basePx: number): number` — `basePx * textScale + spacingStep`, the JS twin of `calc(<base>px * var(--row-scale) + var(--row-step))`.

- [ ] **Step 1: Write the failing tests**

Rename the file and update it:

```bash
git mv src/design/git-components.density.test.tsx src/design/git-components.scale.test.tsx
```

In `src/design/git-components.scale.test.tsx`, change the `beforeEach` to reset both axes and add two cases to the `describe`:

```ts
beforeEach(() => {
  useSettingsStore.getState().set("uiSpacing", "compact");
  useSettingsStore.getState().set("uiTextScale", "default");
});
```

```ts
  // The graph gutter is drawn in SVG user units, so it cannot read
  // --row-scale. If PGCommitRow does not hand it the same number the row box
  // used, the lane curves stop meeting the dots -- in the most visible list in
  // the app. Literals, not the expression: if either input moves this fails
  // rather than following along silently.
  it("grows row and graph gutter together when the text scale changes", () => {
    useSettingsStore.getState().set("uiTextScale", "larger");
    const { row, svg } = renderCommitRow();
    // COMMIT_ROW_BASE_H 26 x 1.3 = 33.8, + compact step 0
    expect(row.style.height).toBe("33.8px");
    expect(svg.getAttribute("height")).toBe("33.8");
  });

  it("adds the spacing step on top of the scaled base", () => {
    useSettingsStore.getState().set("uiTextScale", "large");
    useSettingsStore.getState().set("uiSpacing", "spacious");
    const { row, svg } = renderCommitRow();
    // 26 x 1.15 = 29.9, + spacious step 8
    expect(row.style.height).toBe("37.9px");
    expect(svg.getAttribute("height")).toBe("37.9");
  });
```

Also rename the outer `describe("PGCommitRow density", …)` to `describe("PGCommitRow row scale", …)` and update the file's header comment to name both axes.

Append to `src/features/settings/useSettingsStore.test.ts`:

```ts
describe("useRowH", () => {
  it("multiplies the base by the text scale and adds the spacing step", async () => {
    const { useRowH, useSettingsStore: store } = await freshStore();
    store.getState().set("uiTextScale", "larger");
    store.getState().set("uiSpacing", "comfortable");
    const { result } = renderHook(() => useRowH(24));
    // 24 x 1.3 = 31.2, + comfortable step 4
    expect(result.current).toBeCloseTo(35.2, 5);
  });
});
```

Import `renderHook` from `@testing-library/react` at the top of that test file if it is not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/design/git-components.scale.test.tsx src/features/settings/useSettingsStore.test.ts`
Expected: FAIL — `useRowH` is not exported, and the row height is still `26px`.

- [ ] **Step 3: Add the hook**

In `src/features/settings/useSettingsStore.ts`, directly after `useTextScale`:

```ts
/**
 * A row's height in px — the JS twin of
 * `calc(<base>px * var(--row-scale) + var(--row-step))`.
 *
 * One owner rather than the expression repeated at each windowed list, because
 * a window that computes its pitch differently from the rows it measures is
 * the #70 desync, and six copies is six chances to write it differently. The
 * base is MULTIPLIED and the step ADDED, for the reason `index.css` gives:
 * the step is already the user's own number of pixels, the base is what has to
 * hold the text.
 */
export function useRowH(basePx: number): number {
  return basePx * useTextScale() + useSpacingStep();
}
```

- [ ] **Step 4: Repoint the six call sites**

Each is a one-line change; keep the surrounding comments and update the ones that name the old expression.

- `src/screens/RepoBrowser.tsx:366` — `const treeRowH = FILE_TREE_ROW_BASE_H + useSpacingStep();` → `const treeRowH = useRowH(FILE_TREE_ROW_BASE_H);`
- `src/screens/RepoBrowser.tsx:718` — `const diffFoldH = 22 + useSpacingStep();` → `const diffFoldH = useRowH(22);`
- `src/screens/CommitPanel.tsx:643` — `const foldH = 22 + useSpacingStep();` → `const foldH = useRowH(22);`
- `src/screens/DiffViewer.tsx:239` — `const foldH = 22 + useSpacingStep();` → `const foldH = useRowH(22);`
- `src/screens/History.tsx:318` — `const rowH = COMMIT_ROW_BASE_H + useSpacingStep();` → `const rowH = useRowH(COMMIT_ROW_BASE_H);`
- `src/design/git-components.tsx:1630,1635` — replace

```ts
  const step = useSpacingStep();
  …
  const h = rowHeight ?? COMMIT_ROW_BASE_H + step;
```

with

```ts
  const derivedH = useRowH(COMMIT_ROW_BASE_H);
  …
  const h = rowHeight ?? derivedH;
```

`useRowH` must be called unconditionally — it is a hook. Keep it at the top of the component beside the other hook calls, and use `??` afterwards.

Fix every import: remove `useSpacingStep` where it is no longer referenced, add `useRowH`. Then:

```bash
grep -rn "useSpacingStep" src/ | grep -v "\.test\." | grep -v useSettingsStore.ts
```
Expected: NOTHING. `useSpacingStep` survives only as `useRowH`'s own input and for `PGGraphRow`'s SVG feed if that reads it separately — if the grep prints a line, read it and confirm it genuinely needs the raw step rather than a row height.

- [ ] **Step 5: Update the two comments that describe the old arithmetic**

- `src/design/git-components.tsx:268-273` — the `FILE_TREE_ROW_BASE_H` doc comment says a caller "must add `useSpacingStep()`". Replace that sentence with: "A windowing caller needs the pitch as a NUMBER and must get it from `useRowH()`; a literal would desync the window from the rows at any preset but the default (#70)."
- `src/lib/useWindowedList.ts:7` — the comment naming `COMMIT_ROW_BASE_H + useSpacingStep()` becomes `useRowH(COMMIT_ROW_BASE_H)`.

- [ ] **Step 6: Fix `useDiffRowHeight`'s dependency**

`src/lib/useDiffRowHeight.ts` — `--diff-row-h` is `calc(var(--fs-12) * var(--lh-code))`, so it moves with TEXT, not with spacing. Today's dependency is the one axis that cannot change it.

```ts
import React from "react";
import { useSpacingStep, useTextScale } from "@/features/settings/useSettingsStore";
```

```ts
/**
 * Code-row pitch in px, read from CSS rather than restated here.
 *
 * --lh-code stays the owner of code geometry, and 1.55 × 12px is 18.6px — any
 * literal in TypeScript would already be wrong and would desync the window from
 * the rows it is measuring (the #70 lesson).
 *
 * Re-read when either UI scale changes. The TEXT scale is the one that
 * actually moves this value — `--diff-row-h` is derived from `--fs-12` — and
 * spacing is kept as a dependency because that is when the theme layer
 * rewrites geometry-adjacent tokens.
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:
```
~/Library/pnpm/pnpm vitest run --project unit src/design src/screens src/lib src/features/settings
~/Library/pnpm/pnpm tsc --noEmit
```
Expected: PASS. `History.virtual.test.tsx` and `RepoBrowser.virtual.test.tsx` exercise the windowed pitches — if either fails, the row height and the window disagree; fix the call site rather than the assertion.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(design): one owner for a row's pitch in JS" -m "Six windowed surfaces computed BASE + useSpacingStep() by hand and each
now needs the text scale too. useRowH(base) owns the arithmetic instead,
as the JS twin of calc(<base>px * var(--row-scale) + var(--row-step)) --
a window that computes its pitch differently from the rows it measures is
the #70 desync, and six copies is six chances to diverge.

Also fixes useDiffRowHeight, which re-read --diff-row-h when the SPACING
changed. That value is derived from --fs-12, so text size is the one axis
that can move it and the only one it was not watching.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The commit row's text-sized columns follow the text scale

`SHA_COL_W = 70` is documented as "seven hex digits of monospace, plus the gap"; `DATE_COL_W` is sized to a rendered date string. At the largest preset both are narrower than the text they exist to hold, and truncating a sha or a timestamp destroys its meaning.

**Files:**
- Modify: `src/design/graph-geometry.ts:42-46,49,61,81-94,117-123`
- Modify: `src/design/git-components.tsx:1671`
- Modify: `src/screens/History.tsx:130,205,867`
- Modify: `src/features/settings/useSettingsStore.ts` (`useDateColumnWidth`)
- Test: `src/design/git-components.narrow.test.tsx`

**Interfaces:**
- Consumes: `useTextScale()` (Task 2).
- Produces:
  - `export const shaColW = (scale?: number): number`
  - `export const colPad = (scale?: number): number`
  - `export const subjectMinW = (scale?: number): number`
  - `export const authorMinW = (scale?: number): number`
  - `export const authorColW = (scale?: number): number`
  - `export const dateColW = (fmt: DateFormat, scale?: number): number`
  - `export const commitListMinW = (scale?: number): number`
  - `commitRowGrid(graphW: number, dateW?: number, scale?: number): string`
  - Every one defaults `scale` to `1`, so a caller with no notion of the setting (tests, any surface that never scales) gets exactly the old numbers.
  - The bare constants `SHA_COL_W`, `COL_PAD`, `SUBJECT_MIN_W`, `AUTHOR_MIN_W`, `AUTHOR_COL_W`, `COMMIT_LIST_MIN_W` stay exported as the ×1 values, because that is what the functions are built from and what the tests pin.

- [ ] **Step 1: Write the failing tests**

In `src/design/git-components.narrow.test.tsx`, replace the `it("fits every minimum inside the narrowest commit list", …)` case with:

```ts
  // The floors are only worth anything if they FIT. Past the sum of the
  // minimum tracks the grid overflows its pane and the date falls off the
  // right edge, so the narrowest pane the app can produce has to hold them.
  //
  // Asserted at EVERY text preset, not only at x1: the columns are sized to
  // text, so they all move together and a floor that stayed at 420 would push
  // the Date column off the edge the moment someone picked Large. The sum is
  // re-derived from commitRowGrid's own template rather than from the same
  // expression commitListMinW uses -- otherwise this asserts nothing, and what
  // it is here to catch is a NEW fixed column added to the grid and not to the
  // formula.
  it("fits every minimum inside the narrowest commit list, at every text preset", () => {
    for (const scale of Object.values(TEXT_SCALE)) {
      const template = commitRowGrid(graphWidth(4), dateColW("relative", scale), scale);
      const tracks = template.split(" ");
      const sum = tracks.reduce((acc, t) => {
        const px = /^(\d+(?:\.\d+)?)px$/.exec(t);
        if (px) return acc + Number.parseFloat(px[1]);
        const mm = /^minmax\((\d+(?:\.\d+)?)px,/.exec(t);
        if (mm) return acc + Number.parseFloat(mm[1]);
        return acc;
      }, 0);
      expect(sum, `scale ${scale}`).toBeLessThanOrEqual(commitListMinW(scale));
    }
  });

  // The avatar and the flex gap after it are not type, so they do not scale --
  // but COL_PAD does, because it exists to make the NAME truncate before it
  // touches the date. Below this the "who" goes as well as the name.
  it("keeps the author's avatar inside the author minimum at every preset", () => {
    for (const scale of Object.values(TEXT_SCALE)) {
      expect(authorMinW(scale), `scale ${scale}`).toBeGreaterThanOrEqual(
        16 + 6 + colPad(scale),
      );
    }
  });

  // A sha is seven hex digits of monospace: the column is sized to text, so it
  // has to move with text or it truncates the one value truncation destroys.
  it("grows the sha and date columns with the text scale", () => {
    expect(shaColW(1)).toBe(SHA_COL_W);
    expect(shaColW(1.3)).toBeGreaterThan(SHA_COL_W);
    expect(dateColW("relative", 1)).toBe(DATE_COL_W.relative);
    expect(dateColW("relative", 1.3)).toBeGreaterThan(DATE_COL_W.relative);
  });
```

Update that file's imports:

```ts
import {
  AUTHOR_COL_W,
  AUTHOR_MIN_W,
  COL_PAD,
  COMMIT_LIST_MIN_W,
  DATE_COL_W,
  SHA_COL_W,
  SUBJECT_MIN_W,
  authorMinW,
  colPad,
  commitListMinW,
  commitRowGrid,
  dateColW,
  graphWidth,
  shaColW,
} from "./graph-geometry";
import { TEXT_SCALE } from "@/features/settings/useSettingsStore";
```

The two existing `commitRowGrid(…)` template assertions keep working unchanged, because `scale` defaults to 1.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/design/git-components.narrow.test.tsx`
Expected: FAIL — `shaColW` is not exported.

- [ ] **Step 3: Make the widths functions of the scale**

In `src/design/graph-geometry.ts`, keep every existing constant and its comment, and add beneath them:

```ts
// ─── Text-scaled widths ──────────────────────────────────────────────────────
//
// Every constant above is sized to TEXT: a sha is seven hex digits of
// monospace, the Date column is the widest string its format can produce, the
// subject floor is a readable number of characters. So they all move with the
// user's Text size preset, or the column truncates the very thing it was sized
// to hold — and for a sha or a timestamp, truncation destroys the meaning.
//
// `scale` defaults to 1 so a caller with no notion of the setting — tests, any
// surface that never scales — gets exactly the pre-scale numbers. The avatar
// (16px) and the flex gap after it are NOT type and do not scale; see
// `authorMinW`.
//
// Rounded to a tenth, the same precision applyTextScale writes the ramp at, so
// a template string never carries a 17-digit float.

const px = (n: number): number => Math.round(n * 10) / 10;

export const shaColW = (scale = 1): number => px(SHA_COL_W * scale);
export const colPad = (scale = 1): number => px(COL_PAD * scale);
export const subjectMinW = (scale = 1): number => px(SUBJECT_MIN_W * scale);
export const authorColW = (scale = 1): number => px(AUTHOR_COL_W * scale);
/** Avatar and gap are fixed; only the truncation gutter is type-sized. */
export const authorMinW = (scale = 1): number => px(16 + 6 + COL_PAD * scale);
export const dateColW = (fmt: DateFormat, scale = 1): number =>
  px(DATE_COL_W[fmt] * scale);

/**
 * The narrowest the commit list may be dragged to, at a given text scale.
 *
 * Scaled with the columns it is the sum of — a floor that stayed at 420 while
 * the columns grew would push the Date column off the right edge the moment
 * someone picked Large, which is exactly the overflow
 * `git-components.narrow.test.tsx` exists to prevent. `graphWidth` is not in
 * the scale: lanes are dots and strokes in SVG user units, and they follow row
 * HEIGHT, not type.
 */
export const commitListMinW = (scale = 1): number =>
  Math.ceil(
    graphWidth(4) +
      shaColW(scale) +
      subjectMinW(scale) +
      authorMinW(scale) +
      dateColW("relative", scale),
  );
```

Then widen `commitRowGrid`:

```ts
export const commitRowGrid = (
  graphW: number,
  dateW: number = DATE_COL_W.relative,
  scale = 1,
): string => {
  const cols =
    `${shaColW(scale)}px minmax(${subjectMinW(scale)}px, 1fr) ` +
    `minmax(${authorMinW(scale)}px, ${authorColW(scale)}px) ${dateW}px`;
  return graphW > 0 ? `${graphW}px ${cols}` : cols;
};
```

Extend its doc comment with: "`scale` is the user's Text size preset. It defaults to 1 for the same reason `dateW` defaults to the relative width — a caller that knows nothing about the setting gets exactly the old template."

- [ ] **Step 4: Pass the scale from the two callers, and scale the date width**

- `src/features/settings/useSettingsStore.ts` — `useDateColumnWidth`:

```ts
export function useDateColumnWidth(): number {
  return dateColW(useDateFormat(), useTextScale());
}
```

Change its import at the top of the file from `import { DATE_COL_W } from "@/design/graph-geometry";` to `import { dateColW } from "@/design/graph-geometry";`, and check whether `DATE_COL_W` is still referenced anywhere else in that file — if not, drop it from the import. Extend the function's doc comment: "…then hand the SAME number to `commitRowGrid`, which is what keeps the header aligned with the rows under it when the format OR the text size changes."

- `src/design/git-components.tsx:1671` — `gridTemplateColumns: commitRowGrid(graphW, dateW),` → `gridTemplateColumns: commitRowGrid(graphW, dateW, textScale),`, where `textScale` is `useTextScale()` called at the top of the component beside `useRowH`.
- `src/design/git-components.tsx:1729,1794` — `paddingRight: COL_PAD` → `paddingRight: colPad(textScale)`. Update the import on line 25 to bring in `colPad` and drop `COL_PAD` if it is no longer used there.
- `src/screens/History.tsx:867` — `commitRowGrid(graphW, dateW)` → `commitRowGrid(graphW, dateW, textScale)`, with `const textScale = useTextScale();` beside the existing hooks in that component.
- `src/screens/History.tsx:130` — `HEADER_LABEL`'s `paddingRight: COL_PAD` is a module-level constant, so it cannot call a hook. Leave the constant at `COL_PAD` and instead override it at the header's usage site with `paddingRight: colPad(textScale)` in the inline style, keeping the constant as the ×1 default. If `HEADER_LABEL` is spread into several header cells, add the override to each spread: `style={{ ...HEADER_LABEL, paddingRight: colPad(textScale) }}`.
- `src/screens/History.tsx:205` — `siblingMin: COMMIT_LIST_MIN_W,` → `siblingMin: commitListMinW(textScale),`. Confirm the enclosing function is a component or hook body so `useTextScale()` is legal there; if it is not, thread the value in from the caller rather than calling the hook.

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```
~/Library/pnpm/pnpm vitest run --project unit src/design src/screens/History.virtual.test.tsx src/features/settings
~/Library/pnpm/pnpm tsc --noEmit
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(history): commit-row columns follow the text-size preset" -m "SHA_COL_W is seven hex digits of monospace and DATE_COL_W is the widest
string its format can produce, so both are narrower than their own
content at the larger presets -- and truncating a sha or a timestamp
destroys the value rather than shortening it.

COMMIT_LIST_MIN_W scales with the columns it is the sum of, because a
floor left at 420 while the columns grew would push the Date column off
the right edge the moment someone picked Large. The narrow-pane guard now
runs at every preset and re-derives the sum from commitRowGrid's own
template, so it still catches a new fixed column added to the grid and
not to the formula.

The avatar and its gap do not scale -- they are not type. Only the
truncation gutter beside them does.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The Appearance page

**Files:**
- Modify: `src/features/settings/pages/appearance.tsx:43` (meta) and `:181-196` (the control)
- Test: `src/screens/Settings.appearance.test.tsx`

**Interfaces:**
- Consumes: `SPACING_STEP_PX`, `TEXT_SCALE`, `UiSpacing`, `UiTextScale` (Tasks 1–2).
- Produces: settings-index row ids `appearance.textSize` and `appearance.spacing`.

- [ ] **Step 1: Write the failing test**

Append to `src/screens/Settings.appearance.test.tsx`:

```ts
// Settings is a registry: a row absent from `meta` is a setting the search
// cannot find, and hints are ReactNode and are NOT indexed -- which is why the
// words a user would actually type live in `keywords`.
describe("Appearance size controls", () => {
  it("indexes both new size rows, and no longer the retired density row", () => {
    const rows = meta.cards.flatMap((c) => c.rows);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("appearance.textSize");
    expect(ids).toContain("appearance.spacing");
    expect(ids).not.toContain("appearance.density");
  });

  // The vocabulary this build no longer displays still has to find its
  // replacement: someone who learned the word "density" must land on Spacing.
  it("keeps the retired vocabulary searchable on the spacing row", () => {
    const row = meta.cards.flatMap((c) => c.rows).find((r) => r.id === "appearance.spacing")!;
    for (const word of ["density", "compact", "comfortable"]) {
      expect(row.keywords).toContain(word);
    }
  });

  it("keeps font-size vocabulary searchable on the text row", () => {
    const row = meta.cards.flatMap((c) => c.rows).find((r) => r.id === "appearance.textSize")!;
    for (const word of ["font", "text", "larger"]) {
      expect(row.keywords).toContain(word);
    }
  });
});
```

Import `meta` from `@/features/settings/pages/appearance` at the top of that file if it is not already imported.

- [ ] **Step 2: Run it to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens/Settings.appearance.test.tsx`
Expected: FAIL — `appearance.textSize` is not in the index.

- [ ] **Step 3: Replace the meta row**

`src/features/settings/pages/appearance.tsx:43` — replace the single `appearance.density` entry with two. Keep them adjacent and directly before `appearance.dateFormat` so the three size controls read as a group with `appearance.zoom`:

```ts
        { id: "appearance.textSize", label: "Text size", keywords: "font size text type bigger smaller larger readable accessibility scale" },
        { id: "appearance.spacing", label: "Spacing", keywords: "density compact cozy comfortable spacious row height breathing room padding" },
```

- [ ] **Step 4: Replace the control**

Replace the whole `<SettingsRow id="appearance.density" …/>` block (lines ~181–196) with:

```tsx
      <SettingsRow
        id="appearance.textSize"
        label="Text size"
        hint={`Scales the type everywhere, code and diffs included — ${Math.round(
          TEXT_SCALE.larger * 100,
        )}% at the largest. Rows grow to fit it; icons and borders don’t — use Zoom below for those.`}
        control={
          <PGButtonGroup
            size="sm"
            value={s.uiTextScale}
            onChange={(v) => s.set("uiTextScale", v as UiTextScale)}
            options={[
              { value: "small", label: "Small" },
              { value: "default", label: "Default" },
              { value: "large", label: "Large" },
              { value: "larger", label: "Larger" },
            ]}
          />
        }
      />

      <SettingsRow
        id="appearance.spacing"
        label="Spacing"
        hint={`How much breathing room every list row gets — compact is the dense IDE feel, spacious adds ${SPACING_STEP_PX.spacious}px to each row.`}
        control={
          <PGButtonGroup
            size="sm"
            value={s.uiSpacing}
            onChange={(v) => s.set("uiSpacing", v as UiSpacing)}
            options={[
              { value: "compact", label: "Compact" },
              { value: "cozy", label: "Cozy" },
              { value: "comfortable", label: "Comfortable" },
              { value: "spacious", label: "Spacious" },
            ]}
          />
        }
      />
```

Update the imports at the top of the file: replace `DENSITY_STEP_PX` with `SPACING_STEP_PX, TEXT_SCALE`, and add the `UiSpacing` and `UiTextScale` types.

- [ ] **Step 5: Check the button group fits**

Four options with "Comfortable" in them is wider than the three-option Date format row beside it. Run the app or the component test and look at the control column. If it overflows, add `stacked` to the `SettingsRow` — the same escape hatch `appearance.headMarks` already uses — rather than shortening a label. Do NOT switch to a native `<select>`; a guard test fails the build.

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```
~/Library/pnpm/pnpm vitest run --project unit src/screens/Settings.appearance.test.tsx src/features/settings
~/Library/pnpm/pnpm tsc --noEmit
```
Expected: PASS, including `settings.index.test.tsx`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): Text size and Spacing controls in Appearance" -m "Two PGButtonGroups replace the binary UI density row, placed together
above Zoom so the three size controls read as one group. Text size's hint
names what it does NOT scale, so the difference from Zoom is on screen
rather than inferred.

The spacing row keeps density, compact and comfortable in its keywords:
hints are ReactNode and are not indexed, so the vocabulary this build no
longer displays would otherwise stop finding its own replacement.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E, docs, and the full-suite gate

**Files:**
- Modify: `e2e/specs/settings.e2e.ts:50,248-330`
- Modify: `docs/dev/frontend.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Read the e2e skill before touching the spec**

Read `.claude/skills/e2e-testing/SKILL.md` in full. It is a hard requirement in `CLAUDE.md` before writing or debugging any e2e spec.

- [ ] **Step 2: Update the e2e spec**

`e2e/specs/settings.e2e.ts:248` — the case is titled "UI density scales every row surface, and compact restores them" and hardcodes `const STEP = 4; // DENSITY_STEP_PX.comfortable` at line 300.

Retitle it "Spacing scales every row surface, and compact restores them", drive the new **Spacing** control instead of **UI density**, and keep `STEP = 4` by selecting **Comfortable** — the value and the label are both unchanged, so the assertions below it hold as written. Update the comment at line 300 to `// SPACING_STEP_PX.comfortable` and the one at line 50 to spell the new call-site form, `calc(Npx * var(--row-scale) + var(--row-step))`.

Add one case beside it, since this is the axis no unit test can measure — jsdom does not resolve `calc()`, so a real webview is the only place the scaled ramp and the scaled row are observable together:

```ts
  it("Text size scales the type and the rows that hold it", async () => {
    await openSettingsPage("appearance");
    const before = await browser.execute(() => {
      const el = document.querySelector('[data-testid="commit-row"]');
      return {
        fs: getComputedStyle(document.documentElement).getPropertyValue("--fs-13").trim(),
        rowH: el ? Math.round(el.getBoundingClientRect().height) : 0,
      };
    });

    await clickButtonGroupOption("appearance.textSize", "Larger");

    const after = await browser.execute(() => {
      const el = document.querySelector('[data-testid="commit-row"]');
      return {
        fs: getComputedStyle(document.documentElement).getPropertyValue("--fs-13").trim(),
        rowH: el ? Math.round(el.getBoundingClientRect().height) : 0,
      };
    });

    expect(after.fs).toBe("16.9px");
    // The row has to grow with the type or it clips it — this is the whole
    // point of --row-scale, and jsdom cannot see it.
    expect(after.rowH).toBeGreaterThan(before.rowH);

    await clickButtonGroupOption("appearance.textSize", "Default");
    const restored = await browser.execute(
      () => getComputedStyle(document.documentElement).getPropertyValue("--fs-13").trim(),
    );
    expect(restored).toBe("13px");
  });
```

`openSettingsPage` and `clickButtonGroupOption` are illustrative names — use whatever helpers this spec file already defines for navigating Settings and clicking a `PGButtonGroup` option, reading them from the existing density case directly above. Do not invent a new helper if one is already there.

- [ ] **Step 3: Type-check the e2e spec**

Run: `~/Library/pnpm/pnpm exec tsc -p e2e/tsconfig.json --noEmit`
Expected: clean. The root `tsc` excludes `e2e/`, so this is a separate gate.

- [ ] **Step 4: Update the docs**

- `docs/dev/frontend.md` — find the density section. Rewrite it to cover both axes: the two tables and where they live, the `calc(<base>px * var(--row-scale) + var(--row-step))` call-site form, `useRowH` as the JS twin, the three JS geometries (diff pitch, commit-row columns, SVG graph gutter), and the §4 boundary — text size moves type, row bases and text-sized columns; Zoom is what moves icons, borders and gaps. Name `test/uiScale.test.ts` as the guard.
- `CLAUDE.md` — in the design-system bullet, replace "New list-row surfaces opt into UI density (`var(--row-step)`)." with:

```
  New list-row surfaces opt into BOTH UI scales —
  `calc(<base>px * var(--row-scale) + var(--row-step))`, base multiplied and
  step added — or `test/uiScale.test.ts` fails the build; JS geometry uses
  `useRowH()`.
```

Keep the edit to one bullet: `CLAUDE.md` is deliberately short and a new section needs a reason a pointer cannot serve.

- [ ] **Step 5: Run the whole unit + docs suite**

Run: `~/Library/pnpm/pnpm test`
Expected: PASS. `test/docs.test.ts` reads `CLAUDE.md` and `docs/dev/` — if it fails, the doc set has fallen behind the tree; fix the doc, not the test.

Note: `ImageDiffView` has a known ~1-in-111 flake. A red `unit` on a diff that never touched `features/diff` is that — re-run once before investigating.

- [ ] **Step 6: Build the e2e snapshot and run the one spec**

```bash
cd /Users/jonas/dev/fun/platypusgit/.claude/worktrees/ui-scale
~/Library/pnpm/pnpm test:e2e:docker build
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/settings.e2e.ts
```

Never rely on a stale snapshot after a `src/` change. Only one cold container build at a time across ALL worktrees.

- [ ] **Step 7: Commit and open the PR**

```bash
git add -A
git commit -m "docs: the two UI scales, and an e2e case for the text one" -m "jsdom does not resolve calc(), so a real webview is the only place the
scaled ramp and the scaled row can be observed together -- which is
exactly the pair that breaks if the type grows and the base does not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"

git push -u origin feat/ui-scale
```

Then open the PR with `gh pr create --body-file <file>` (a `--body` with prose is refused in a worktree-isolated session). Verify the ruleset's `allowed_merge_methods` before merging — `gh api repos/:owner/:repo/rulesets/18319179` — and believe the ruleset over `CLAUDE.md` if they disagree.

---

## Self-Review

**Spec coverage.** §1 settings + labels → Tasks 1, 2, 6. §1 defaults and upgrade → Task 1 Step 5. §1 migration incl. export/import → Task 1 Step 5 (`coerceSettings` is the single point both paths use — verified, `load()` calls it and so does `importSettings`). §2 spacing mechanism → Task 1. §2 ramp from JS → Task 2. §2 row bases → Task 3. §3 the three JS geometries → Task 4 (diff pitch, graph gutter) and Task 5 (columns). §4 scope boundary → stated in Task 2's `TEXT_SCALE` comment and Task 6's hint; the dead `--s-*` tokens are untouched by every task, as intended. §5 Appearance page → Task 6. §6 invariants 1–6 → ramp ascending (T2), line box (T2), narrow-pane at every preset (T5), migration (T1), `useDiffRowHeight` dependency (T4 Step 6 — covered by the changed deps; the assertion is the e2e case in T7, since jsdom cannot resolve the calc that produces the value). §7 documentation → Task 7.

**Deviation from the spec, deliberate:** the spec named `PGSelect` for both controls. The plan uses `PGButtonGroup`, which is what every other small enum in the Appearance card uses (follow-mode, the retired density row, Date format) — a lone dropdown among button groups would be the inconsistent choice. `stacked` is the documented fallback if four options overflow.

**Placeholder scan.** No TBD/TODO. Two steps are deliberately conditional rather than prescriptive and say exactly how to resolve themselves: Task 3 Step 1's `globSync` fallback (read `test/fileSave.test.ts` and copy its walker) and Task 7 Step 2's e2e helper names (read the density case directly above). Task 1 Step 8's `themeFiles.test.ts` edit depends on what the enclosing `it(…)` asserts, and says to read the title and keep its meaning.

**Type consistency.** `useSpacingStep` (not `useDensityStep`) throughout Tasks 1, 4. `useTextScale()` returns the FACTOR, not the key — used that way in `useRowH`, `commitRowGrid`, `dateColW`, `commitListMinW`, and asserted as a number in the narrow test. `normalizeSpacing`/`normalizeTextScale` both take `unknown` and both read `DEFAULTS`. `applyTextScale` writes `--fs-*` AND `--row-scale`; `applySpacing` writes only `--row-step`. The graph-geometry functions all take `scale` last with a default of 1, and the bare ×1 constants stay exported because the tests and the functions both build on them.
