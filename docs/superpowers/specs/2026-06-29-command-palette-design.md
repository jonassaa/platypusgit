# Command palette / fuzzy finder (⌘P) — design

**Status:** approved
**Date:** 2026-06-29
**Owner:** jonas
**Related:** `docs/superpowers/specs/2026-04-24-centralized-branch-ui-design.md`

## Why

P0 feature: "Command palette / fuzzy finder (⌘P) — jump to branch, file, commit, command."

platypusgit's north star is "extreme usability" for developers. Power users live on the keyboard. A single ⌘P that fuzzy-searches everything — branches, files, recent commits, app screens/commands — collapses many multi-click navigation paths into one. It mirrors the muscle memory devs already have from VS Code, Sublime, Zed.

This is almost entirely a frontend feature. All data already lives in existing Zustand stores (branches, file list, commit log, activity-bar screens). No new backend git ops.

## Scope

### In scope (MVP)

- Global ⌘P / Ctrl+P opens a centered modal fuzzy-finder overlay. Esc closes. ArrowUp/Down move selection, Enter activates. Shortcut ignored when focus is in an input/textarea/contentEditable (matches existing ⌘1…⌘9 handling).
- One query box, mixed result list across four types:
  - **Branch** — local + remote branches → checkout on select.
  - **File** — every worktree file (from `allFiles`) → open in editor + diff via nav intent.
  - **Commit** — recent commits from the log → show commit diff vs working tree via nav intent.
  - **Command / screen** — activity-bar screens + a few global actions (Settings, Fetch, etc.) → switch screen / run action.
- Results grouped/tagged by type, ranked by fuzzy score, capped per type.
- Pure, testable fuzzy-match function in `features/palette/fuzzyMatch.ts` with `fuzzyMatch.test.ts`.

### Out of scope (future)

- Server-side / on-disk file index (uses the in-memory `allFiles` list).
- Content search inside files.
- Customizable command registry / user-defined commands.
- Result preview pane.
- Persisted recent-command MRU ordering.

## Architecture

Frontend-only. No `GitBackend`/Rust changes.

### Fuzzy match (pure)

`src/features/palette/fuzzyMatch.ts`:

```ts
export interface FuzzyResult {
  matched: boolean;
  score: number;          // higher = better; 0 when !matched
  indices: number[];      // matched char positions in the target (for highlight)
}
export function fuzzyMatch(query: string, target: string): FuzzyResult;
```

Subsequence matcher (every query char appears in order in target). Scoring rewards:
consecutive runs, matches at word boundaries (`/`, `-`, `_`, `.`, camelCase, start),
and earlier matches. Empty query → `matched: true, score: 0, indices: []`. Case-insensitive.

### Palette store

`src/features/palette/usePaletteStore.ts` — tiny Zustand store: `{ open, query, openPalette(), closePalette(), setQuery() }`. Just open/query UI state; result data is read live from the other stores inside the component.

### Result assembly

`src/features/palette/CommandPalette.tsx` reads branches/allFiles/commits from `useRepoStore`, builds a static command list from the activity-bar items, runs `fuzzyMatch` over each candidate's display string, sorts, groups by type, caps each group, flattens for keyboard nav.

`allFiles` is lazy — the palette triggers `refreshAllFiles()` when it opens (cheap; same call RepoBrowser uses).

### Selection actions

- Branch → `useRepoStore.checkoutBranch(name)`.
- File → `useNavStore.setIntent({ kind: "diff-file", path })` (existing intent; AppShell already routes it to the diff screen) + `useRepoStore.openInEditor(path)` is NOT auto-run; default action is diff. (Keeps it predictable; open-in-editor stays a context action elsewhere.)
- Commit → `useNavStore.setIntent({ kind: "commit-vs-wt", oid })` (existing intent → commitDiff screen).
- Command/screen → a new nav intent kind `switch-screen` carrying the target screen id, routed in AppShell. This is the only nav-store addition.

### Why a new `switch-screen` intent

Screen switching currently lives in `AppShell` local state (`setScreen`), not reachable from a decoupled overlay. Rather than hoist screen state into a store, add a `NavIntent` of kind `switch-screen` so the palette stays decoupled and AppShell remains the single screen router. Consistent with the existing intent pattern.

## UI / UX

- Centered modal, ~560px wide, max-height ~60vh, rendered via portal to `document.body`, dimmed backdrop. Matches `BranchPicker` styling (bg-1, border-1, r-3, shadow) but centered rather than anchored.
- Top: `PGSearchInput`, autofocused, placeholder "Search branches, files, commits, commands…".
- Body: scroll list grouped by type with section headers (same style as BranchPicker section headers). Each row: type icon, primary label, secondary muted detail (branch upstream / file dir / commit short-oid+relative time / command shortcut). Active row highlighted with `--bg-selection`.
- Empty query shows a default set (all commands + a few recent commits/branches) so the palette is useful with zero typing.
- Mouse hover sets active row; click activates.
- Backdrop click + Esc close.

## State

`usePaletteStore` (Zustand, colocated):

```ts
interface PaletteState {
  open: boolean;
  query: string;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
}
```

No cross-feature state. Result data read live from `useRepoStore`; screen switch via `useNavStore`.

## Errors

No new `AppError` variants. Selection actions delegate to existing store methods that already surface errors via the repo store's `error` banner.

## Testing

- **Frontend pure logic** — `fuzzyMatch.test.ts`: subsequence matching, case-insensitivity, ordering (boundary > mid-word, consecutive > scattered, earlier > later), non-match, empty query, index correctness.
- **Frontend component test** — `CommandPalette.test.tsx`: opens on render when store open; typing filters; ArrowDown+Enter on a command row fires the nav intent; Esc closes. Uses existing `mockInvoke` setup.

## Conventions touched

- New per-feature folder `src/features/palette/` with colocated store + component + pure fn + tests — matches existing pattern.
- One new `NavIntent` kind (`switch-screen`) added to `useNavStore` and routed in `AppShell` — matches the documented cross-screen-intent pattern.
- Design-system imports only (`@/design`); CSS vars / Tailwind v4 tokens for styling.
