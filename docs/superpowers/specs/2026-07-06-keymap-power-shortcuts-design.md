# Keymap Power Shortcuts — Design

**Status:** Approved (user: "do it" — scope from the 2026-07 shortcut review's
missing-but-expected list; decisions made autonomously and documented here)
**Date:** 2026-07-06
**Builds on:** `2026-07-02-keyboard-navigation-v2-design.md`

## Why

The 2026-07 shortcut usability review (Opus) found the binding tables sound
after fixes, but flagged shortcuts users of git GUIs / JetBrains expect and
platypusgit lacks. This spec covers the ones buildable on existing
capabilities. No new backend ops.

## In scope

| # | Feature | Chord(s) |
| --- | --- | --- |
| 1 | List speed-search (type-to-jump in any pane list) | printable keys; Backspace edits; Escape clears |
| 2 | Commit | ⌘↵ (`Mod+Enter`) |
| 3 | Commit & Push | ⌘⇧↵ (`Mod+Shift+Enter`) |
| 4 | Toggle amend | ⌘⇧M (`Mod+Shift+M`) |
| 5 | Stage all / Unstage all | ⌘⇧S / ⌘⇧U |
| 6 | New branch (palette input step) | ⌘N (`Mod+N`) |
| 7 | VCS-popup nod: palette on ⌃V (Rider `Vcs.QuickListPopupAction`) | `Ctrl+V`, rider preset, macOS-effective only |
| 8 | Next / previous change in diff | F7 / ⇧F7 (Rider `NextDiff`/`PreviousDiff`) |

Both presets get 2–6 and 8 (same chords — collision-free on all platforms,
see chord rationale). 7 is rider-only flavor.

## Out of scope (deliberate)

- **Undo last operation (⌘Z)** — needs its own reflog-based safety design;
  a mis-scoped undo on a git repo is data loss. Separate spec.
- **Dedicated stash chord** — reachable via palette / ⌃V quick list; chord
  surface stays small. Revisit on demand.
- **⌘F in-list filter UI** — speed-search covers the v1 need without new
  filter widgets. Revisit if speed-search proves insufficient.

## Chord rationale

- `Mod+Enter` commit: JetBrains commit dialog and every chat box on earth.
  Works while typing the message (modifier-chord input policy).
- `Mod+Shift+Enter` commit & push: shift-extends commit, mirrors the panel's
  two buttons.
- `Mod+Shift+M` amend: M for aMend; ⌘⇧M/Ctrl+Shift+M has no entrenched
  desktop meaning worth protecting in a git client.
- `Mod+Shift+S` / `Mod+Shift+U`: Stage/Unstage mnemonics. ⌘⇧S "Save As" has
  no meaning in a git GUI; Ctrl+Shift+S likewise app-local.
- `Mod+N` new branch: "new" convention (GitHub Desktop ⌘N territory); webview
  new-window default is suppressed by the capture handler.
- `Ctrl+V`: literal-Ctrl chord. On macOS ⌃V is Rider's VCS quick list — deep
  muscle memory. On Windows/Linux physical Ctrl+V arrives as canonical
  `Mod+V` (chord.ts collapses Ctrl into Mod there), so the `Ctrl+V` binding
  can never match — paste is untouched by construction.
- `F7`/`Shift+F7`: Rider's actual next/previous-diff bindings. On Mac
  laptops F7 wants the fn key — same trade JetBrains ships with.
- No new `Mod+Alt+letter` chords: Ctrl+Alt = AltGr on Windows (types
  characters on many European layouts) — rule from the review fixes.

## Design

### 1. Speed-search

JetBrains-style: with a list pane focused, typing jumps the selection to the
first row whose search text contains the query (case-insensitive substring).
Non-destructive — no filtering, rows never disappear.

- **Dispatcher fallback** (`useKeymapStore.dispatch`): when a keydown resolves
  to no bound chord, is a single printable character without Mod/Ctrl/Alt,
  the target is not editable, and the focused pane registered a speed-search
  handler → append the char to that pane's query, invoke the handler, claim
  the event. `Backspace` (unbound, no mods) pops a char while the query is
  non-empty. The keymap principle "no handler reads raw keys" gains one
  documented exception: unbound printable keys are data (the query), not
  chords.
- **Query state** in a new `useSpeedSearchStore`: `Record<paneId, string>`.
  Cleared on pane-focus change, Escape, and pane unregister.
- **Escape** stays inside the action system: while its pane's query is
  non-empty, `usePaneList` registers an `app.closeOverlay` handler that
  clears the query and claims; with an empty query it declines and Escape
  falls through to the overlay/cheat-sheet chain as today.
- **`usePaneList`** gains `searchText?: (i: number) => string` (subject for
  history, ref name for branches, path for file lists, message for reflog).
  When provided, the hook registers the pane's speed-search handler: on query
  change, select the first matching index (no match → selection unchanged).
- **Chip UI**: `PGPane` renders a small floating `kbd`-style chip
  (bottom-right) showing the live query for its pane id — generic, no
  per-screen wiring.

Wired into: History, Branches, CommitPanel files, Reflog, FileHistory,
DiffViewer file list. (RepoBrowser tree keeps its own DOM-level typeahead
out of scope — different widget.)

Known limitation: characters that ARE bound chords never reach the query —
notably Space (list.toggle). Queries are substrings, so searching around a
space ("add" instead of "add b") covers the practical cases; revisit only if
it bites.

### 2–4. Commit-screen chords

New catalog actions `commit.commit`, `commit.commitAndPush`,
`commit.toggleAmend` — global scope, **no default runners**: the commit
message/body/amend state is CommitPanel component state, so CommitPanel
registers handlers via `useAction` while mounted. Unmounted (other screens) →
chord falls through. Handlers mirror the buttons' enabled logic (decline when
disabled: nothing staged and not amending, empty message, push needs remote +
branch); the commit/commit-and-push flows are extracted from the two button
onClicks into shared functions so buttons and chords cannot drift.

### 5. Stage all / Unstage all

New actions `repo.stageAll` / `repo.unstageAll` with default runners in
`features/repo/ops.ts` (pattern: fetchAllOp). Runner reads status from
`useRepoStore`, derives the unstaged/staged path lists (same expressions as
the CommitPanel buttons), calls `stage()`/`unstage()`; declines when no repo
or empty list. Works from any screen — the commit panel reflects it on next
visit; the status bar and badges refresh via the store.

### 6. New branch

Action `branch.createNew`, default runner: decline when no repo; otherwise
open the palette directly on the existing "Create branch" input step. The
step builder is extracted from `commands.ts` (`createBranchInputStep()`) and
reused by both the palette command and the runner — one definition.

### 7. Palette on ⌃V

Third chord on `palette.open` in the rider preset only. No new action.

### 8. Diff change navigation

New actions `diff.nextChange` / `diff.prevChange` (scope `pane`), category
`Diff` (new `ActionCategory`, added to the cheat-sheet order). Handlers
registered by DiffViewer (pane `diff.view`) and CommitDiff (pane
`commitDiff.view`): keep a hunk cursor, clamp at ends, scroll the target
hunk into view. Hunk elements become addressable via a `data-hunk-index`
wrapper at the two call sites. Cursor resets when the viewed file changes.
The commit-panel preview diff (single file, usually short) is out of scope.

## Testing

- Unit (vitest): dispatcher speed-search fallback (append, backspace,
  escape-clear via closeOverlay chain, editable-target and modifier guards,
  focus-change clear); preset completeness/collision suites pick up the new
  actions automatically; ops runners (stageAll/unstageAll decline paths);
  create-branch step reuse; hunk-cursor clamp logic.
- e2e (`keymap.e2e.ts` + additions): speed-search jump on Branches
  (type → Enter checks out) and History; ⌘↵ commit and ⌘⇧↵ commit-and-push
  against a real remote pair; amend toggle reflected in the button label;
  ⌘⇧S stages everything (repo truth via porcelain); ⌘N opens the create-branch
  step and creates a branch; F7 moves hunk scroll (assert scrollTop change or
  cursor attribute).
