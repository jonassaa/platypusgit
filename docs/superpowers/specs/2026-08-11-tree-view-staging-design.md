# Tree view: file-type icons, staging in the tree, tree ⇄ flat toggle — design

> **Status: SUPERSEDED — not the shipped design.** A4/A5/A6 shipped via #73
> (`997e1ab`), which covered the same three items plus B4/B5/C3/D1/D2. This
> document and its plan are kept as the design record for the alternative that
> was built in parallel on `feat/tree-view-staging` (PR #72, closed); its e2e
> coverage and a test-flake fix were salvaged separately.
>
> **Where the shipped design differs — read this before trusting anything below:**
>
> | This doc | What shipped in #73 |
> |---|---|
> | `src/lib/fileIcons.ts`, `fileIcon()` | `src/lib/fileIcon.ts`, `fileIconSpec()` |
> | Tri-state `"none" \| "some" \| "all"` | `"none" \| "partial" \| "all"` |
> | Presentational `ChangeTree` wrapper | `PGFileTree` grew `stageState` / `onStageToggle` callbacks directly |
> | `readViewMode` per screen | shared `useTreeViewMode(storageKey, fallback)` hook |
> | Two `ChangeTree`s in CommitPanel | one tree per section, same conclusion, different plumbing |
> | Prune effect must take `viewMode` as a dependency | **not needed** — `buildStatusList` emits flat nodes with identical key shape and the `tree` memo depends on `viewMode`, so the existing prune effect re-runs and drops folder keys structurally. The cleaner fix. |
>
> The reasoning that still holds and matched the shipped result: **two trees per
> section rather than one merged tri-state tree**, because a partially staged
> file legitimately appears in both STAGED and CHANGES.

**Status:** superseded by #73
**Date:** 2026-08-11
**Owner:** jonas
**Related:** issue #61 items **A4** (per-file-type icons), **A5** (staging
checkboxes in the tree + directory-level stage/discard), **A6** (tree ⇄ flat
toggle). Tier 0 of #61 landed in `fa398c9`; this is the first Tier 1 slice.
Reuses the `CommitDiffPanel` extraction pattern from #53/#59.

## Why

Issue #61 calls the tree view "under-built" and names it the user's explicit
priority. Tier 0 fixed the cheap parts (path compaction, expand/collapse-all, a
filter box that was inert). What remains is the structural complaint:

> "the nice tree" and "the staging surface" are two unlinked views

Concretely, on `main` today:

- **RepoBrowser** owns the only real nested tree and **cannot stage at all** —
  `PGFileTreeRow` has no checkbox, and right-clicking a folder returns an empty
  menu (`RepoBrowser.tsx:344`).
- **CommitPanel** owns staging and is **flat-only** — long changesets are a wall
  of full paths with no structure.
- Neither can switch. Fork, Sublime Merge and IntelliJ all stage from the tree
  and let you flip tree ⇄ flat per view.
- Every file row in both views draws the same generic `file` glyph, so scanning
  is by text alone.

One nuance the audit understated, verified during design: **folder-level staging
already works via multi-select.** `RepoBrowser.splitSelection` (`:291-337`)
expands a selected folder key into every visible descendant, excludes embedded
repos, and routes to `multiFileMenuItems`. The missing pieces are narrower than
"add directory staging": a folder *context menu*, and *checkboxes*.

## Scope

### In scope

- **`src/lib/fileIcons.ts` (new, pure).** `fileIcon(path) → { icon: IconName;
  tint: string }`. Extension → one of nine families, generic `file` as fallback.
  - Families and tints: `code` `--accent-2`, `markup` `--accent-2`, `style`
    `--accent-4`, `config` `--accent-3`, `doc` `--fg-2`, `image` `--accent-5`,
    `lock` `--fg-3`, `archive` `--fg-3`, `binary` `--fg-3`.
  - Matching is on the lowercased final extension, with a small set of
    whole-filename special cases (`Dockerfile`, `Makefile`, `*.lock`,
    `pnpm-lock.yaml`, `Cargo.lock`). Unknown extension → `file` + `--fg-2`.
- **Seven new stroke glyphs** in `src/design/icons.tsx`, drawn in the existing
  stroke style: `fileMarkup`, `fileStyle`, `fileConfig`, `fileDoc`,
  `fileImage`, `fileArchive`, `fileBinary`. The `code` family reuses the
  existing `fileCode` glyph and the `lock` family reuses the existing `lock`
  glyph — both are already in the set.
- **`src/lib/tree.ts` (edit, pure).**
  - `buildStatusTree` gains a **staging rollup**: every node carries
    `staged: "none" | "some" | "all"`, computed bottom-up over the node's
    changed descendants. A leaf is `"all"` when `isStaged(st) && !isUnstaged(st)`,
    `"some"` when both (partially staged), `"none"` otherwise. Unmodified leaves
    and folders with no changed descendants carry `staged: undefined` — that is
    the signal to render no checkbox.
  - New exported `expandTreeKeys(keys, files)` — the folder-expansion logic
    currently inline in `RepoBrowser.splitSelection`, lifted verbatim in
    behavior: a key that resolves to a `FileStatus` yields that status; a key
    that does not is treated as a folder prefix and yields every entry beneath
    it. Deduplicates by path. RepoBrowser's `splitSelection` is rewritten to
    call it, so the two screens cannot drift.
- **`src/design/git-components.tsx` (edit).**
  - `PGFileTreeRow` gains optional `checked`, `indeterminate`, `onCheck`,
    `icon`, `iconColor`, `additions`, `deletions`.
  - `PGFileTree` threads per-node checkbox state and icon through to the row. It
    takes **no mode prop** — whether a given row gets a checkbox is decided by
    `ChangeTree` and expressed per node, so the primitive stays dumb.
  - `PGChangeRow.status` becomes optional; when absent the row renders no status
    mark. Needed for unmodified rows in RepoBrowser's flat all-files mode.
  - `PGCheckbox` already supports `indeterminate` — no primitive change.
  - When `onCheck` is absent the row renders exactly as today, so every existing
    `PGFileTree` mount site is unaffected.
  - The checkbox slot reserves its width even when a row has no checkbox, so
    names stay aligned down the column.
- **`src/features/repo/ChangeTree.tsx` (new, presentational).** Renders a list
  of file slots as **tree** (`PGFileTree`) or **flat** (`PGChangeRow`), with
  icons, checkboxes and row callbacks. Props:
  `{ files, viewMode, expanded, onToggleExpand, selectedKeys, primaryKey,
  onSelect, onActivate, onRowContextMenu, onCheck, checkboxMode, showStatus,
  keyOf }`.
  - **Presentational only.** It owns no selection, no keyboard handling and no
    store access — mirroring `CommitDiffPanel`. Screens keep computing row order
    from the existing pure `flattenFileTree`, which is what lets CommitPanel's
    shift-range keep crossing the STAGED → CHANGES boundary.
  - `checkboxMode: "always" | "changed-only" | "none"`.
- **RepoBrowser** — mounts one `<ChangeTree>`; gains a tree ⇄ flat toolbar
  toggle and a **folder context menu**.
- **CommitPanel** — mounts two `<ChangeTree>`s (STAGED, CHANGES); gains a tree ⇄
  flat toolbar toggle. Section headers, badges and Stage-all / Unstage-all
  buttons are unchanged in both modes.

### Out of scope

- **A7** — tree speed-search and `Shift+Arrow` range select (adopting
  `usePaneList` inside `PGFileTree`). Touches keymap focus plumbing; separate
  slice.
- **A8** — virtualization.
- **B4** — remapping `--git-*` / `--graph-*` / `--accent-2..5` in `applyTheme`.
  See Risks.
- **Merged tri-state tree** in CommitPanel (one tree spanning both sides). Two
  trees was chosen deliberately — see Behavior.
- **CommitDiff / Conflict screens.** They stay flat. `ChangeTree` is built so
  they can adopt it later, but wiring them is not part of this slice.

## Behavior

### View mode

`viewMode: "tree" | "flat"` per screen, persisted to
`localStorage["pg-browser-view"]` and `localStorage["pg-commit-view"]`.

Defaults preserve today's behavior exactly: **RepoBrowser defaults to tree,
CommitPanel to flat.** Nobody's existing layout changes on upgrade.

The toggle is a two-state `PGIconButton` pair in each list's toolbar, beside the
existing expand/collapse-all buttons in RepoBrowser.

Expand state survives a round trip: switching to flat and back restores the
folders that were open, because `expanded` stays owned by the screen and is
simply unused while flat. Expand/collapse-all buttons are disabled in flat mode.
*File* selections also survive the switch — the same keys address the same files
in both modes, so the primary row stays selected and the diff pane does not
reload.

*Folder* selections must be dropped, and this needs an explicit change.
RepoBrowser's prune effect (`:268-270`) validates against `flattenAllKeys(tree)`
and is keyed on `[tree]`, which does not change when only the view mode flips —
so a folder key selected in tree mode would survive invisibly into flat mode and
still be expanded by `splitSelection`, silently widening a Stage or Discard
batch to files the user cannot see. The prune effect therefore takes `viewMode`
as a dependency, and in flat mode its valid set is file keys only.

### Why two trees in CommitPanel, not one

CommitPanel is not one list — it is two sections over a shared row order, and a
**partially staged file appears in both** (`isStaged` and `isUnstaged` are not
mutually exclusive). A single merged tree would need one row to represent a file
that is simultaneously staged and unstaged, plus a rule for which side the diff
pane shows. Two trees keeps every existing semantic — `side:path` keys, the
cross-section shift-range, `side`-keyed diff loading — and reduces tree mode to
a rendering swap.

### Keys

Row keys are unchanged in both screens: RepoBrowser uses `/a/b`, CommitPanel
uses `side:path`. `PGFileTree` builds `/a/b` internally; `ChangeTree` maps back
through the caller-supplied `keyOf` before invoking `onSelect` /
`onRowContextMenu`, so no screen-side selection code changes.

Folder rows produce a key with no matching file entry. Both screens resolve them
through `expandTreeKeys`, which is exactly how RepoBrowser already treats a
selected folder.

### Checkboxes

**RepoBrowser** — `checkboxMode: "changed-only"`. A row gets a checkbox only if
its node carries a `staged` rollup:

| Row | Checkbox |
|---|---|
| Changed file, fully staged | checked |
| Changed file, partially staged | indeterminate |
| Changed file, unstaged | empty |
| Folder with changed descendants | rolled up: all / some / none |
| Unmodified file (all-files mode) | none — blank, width reserved |
| Any row while browsing a committed rev | none |

**CommitPanel** — `checkboxMode: "always"`. Each tree is single-sided, so every
row in STAGED is checked and every row in CHANGES is empty, matching the flat
rows today. Folders render checked / empty to match their section.

### Toggle semantics

- **Leaf** — stage the path, or unstage it, exactly as the flat row does today.
  A **partially staged** leaf (`some`) stages — clicking moves it toward fully
  staged, never backward, matching the folder rule below. The existing
  multi-selection rule carries over unchanged: toggling a row that is part of a
  multi-selection acts on the whole selection (`CommitPanel.togglePaths`,
  `RepoBrowser.splitSelection`).
- **Folder** — resolve descendants through `expandTreeKeys`, then:
  - rollup is `none` or `some` → stage every unstaged descendant;
  - rollup is `all` → unstage every staged descendant.
  In CommitPanel this collapses to "stage all in folder" (CHANGES) and "unstage
  all in folder" (STAGED), since each tree is single-sided.
- **Embedded repos are never in the batch.** `expandTreeKeys` carries forward
  `splitSelection`'s existing partition, which routes embedded entries to
  `embeddedPaths` and out of the stage / unstage / discard subsets.

### Folder context menu

Right-clicking a folder in either screen builds
`multiFileMenuItems(splitSelection([key]))` instead of returning `[]`. That
yields, against the folder's descendants: Stage *n* files, Unstage *n* files,
Copy paths, and Discard changes in *n* files — the same items multi-select
already produces, including the existing destructive-discard confirmation and
the untracked-delete warning.

While browsing a committed rev the context menu stays suppressed, as today
(`RepoBrowser.onTreeContextMenu:361`).

### Flat mode

Flat mode renders `PGChangeRow` with full paths — what CommitPanel shows today.
In RepoBrowser's all-files mode, unmodified rows render with no checkbox and no
status mark. Sort order and the active filter apply identically in both modes;
switching mode never changes which files are shown, only how they are grouped.

## Testing

**Unit (`pnpm test`, pure):**

- `fileIcons` — extension mapping per family, whole-filename special cases,
  case-insensitivity, unknown-extension fallback, extensionless files.
- `buildStatusTree` staging rollup — all / some / none at leaf and folder level,
  partially staged files, unmodified leaves carrying no rollup, rollup surviving
  path compaction (a compacted `src/features/repo` node must roll up its
  descendants, not the pre-merge intermediate).
- `expandTreeKeys` — file key, folder key, nested folder key, embedded-repo
  exclusion, dedup when a file and its parent folder are both selected.

**Component (`pnpm test`, jsdom + RTL):**

- `ChangeTree` renders the same file set as tree and as flat.
- Tri-state checkbox states map from the rollup.
- Folder checkbox click calls `onCheck` with the full descendant path set and no
  embedded entries.
- `checkboxMode: "changed-only"` renders no checkbox for an unmodified row.
- `PGChangeRow` with no `status` renders no status mark (flat all-files mode).
- Switching view mode preserves a file selection and drops a folder selection.

**E2E (`e2e/specs/`, extend existing files — no new spec file):**

- CommitPanel: toggle to tree mode, stage a folder, assert the staged count.
- RepoBrowser: right-click a folder → Stage all, assert status refresh.

Single-window flows, so native `pnpm test:e2e:run --spec …` is fine; rebuild the
snapshot first. Read `.claude/skills/e2e-testing/SKILL.md` before touching specs.

**Gates before PR:** `pnpm tsc --noEmit`, `pnpm exec tsc -p e2e/tsconfig.json
--noEmit`, `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml` (no
backend change expected, but the gate stays), and the two touched e2e specs.

## Risks / notes

- **Icon tints and custom themes (B4 interaction).** `applyTheme`
  (`useSettingsStore.ts:318-338`) does not remap `--accent-2..5`, so under a
  non-default theme the tints keep their default hues. This is pre-existing —
  the folder icon already uses `--accent-4` — and is B4's job to fix, not this
  slice's. Using the accent scale here means tints inherit the fix for free once
  B4 lands. Recorded so it is a known trade-off rather than a surprise.
- **Rollup and path compaction interact.** Compaction merges single-child folder
  chains *after* the tree is built. The rollup must be computed on the compacted
  tree (or recomputed after merging), or a merged node reports the rollup of the
  wrong intermediate. Covered by a dedicated unit test.
- **`git-components.tsx` is 1792 lines.** This slice adds props to two
  components there but puts the new rendering in `ChangeTree`, so the file grows
  by tens of lines, not hundreds. If it keeps growing, splitting the file is a
  follow-up — not in this slice.
- **Behavior preservation is the main regression risk.** RepoBrowser's
  `splitSelection` is load-bearing for destructive ops (discard). Extracting
  `expandTreeKeys` must be behavior-identical; the unit tests for it are written
  against the current implementation's semantics, including the embedded-repo
  partition and the `filteredStatus`-scoped descendant lookup.
- **Row height.** Adding a checkbox to tree rows must not change `--row-h`;
  the checkbox is 14px inside a 22px row, same as `PGChangeRow` today.
