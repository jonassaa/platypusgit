# Command Palette — Actions & Features

**Status:** Approved (design)
**Date:** 2026-06-30
**Feature branch:** `feat/command-palette-actions`

## Goal

Turn the command palette (⌘P) from a navigation + search box into a full
command runner. Today it exposes 10 screen-switches, 2 actions (fetch-all,
refresh), and fuzzy search over branches/files/commits. The backend already
implements ~50 git ops (push, pull, stash, create/merge/rebase branch,
cherry-pick, revert, tag, reset, …) that the palette never surfaces. After this
work, essentially every implemented git op and screen is reachable from the
palette.

## Decisions (locked)

- **Hybrid action model.** Zero-arg ops run directly; single-argument ops pick
  their arg inline inside the palette; complex multi-field ops launch the
  existing screen/UI that already handles them.
- **Hint chips, no prefix syntax.** Root results stay mixed; clickable type
  chips (`All / Commands / Branches / Files / Commits`) narrow the list.
  Keyboard cycle via `⌃Tab` / `⌃⇧Tab`.
- **Frecency + useful empty state.** Track palette item usage in localStorage,
  boost frequently/recently used items in scoring, and on an empty query show a
  curated default screen (recents + current-branch quick actions) instead of
  "Type to search."

## Architecture

### Step-stack state machine

The palette becomes a small state machine instead of a single flat list. A
`PaletteStep` is one of:

```ts
type PaletteStep =
  | { kind: "root" }                                   // mixed search + chips
  | { kind: "pick"; title: string; chip?: ChipKind;    // inline single-pick arg
      items: PaletteItem[]; }
  | { kind: "input"; title: string; placeholder: string;  // inline text arg
      initial?: string;
      validate?: (v: string) => string | null;        // returns error or null
      onSubmit: (v: string) => void; }
```

`usePaletteStore` holds `stack: PaletteStep[]` with `{ kind: "root" }` always at
the bottom.

- `pushStep(step)` — enter a sub-step (e.g. after choosing "Merge branch…").
- `popStep()` — go back one step. `Esc` pops; `Backspace` on an empty query
  pops; popping the root closes the palette.
- The header shows a breadcrumb of step titles (`Merge › pick branch`) so the
  user always sees where they are.
- Query and active chip are per-step concerns: entering a step resets the query;
  popping restores the previous step's query.

### How a `PaletteItem.run()` resolves

Each catalog item's `run()` does exactly one of three things:

1. **Direct** — perform the op (call a `useRepoStore` action) and `closePalette()`.
2. **Inline param** — `pushStep({ kind: "pick" | "input", … })`; the step's
   `onPick`/`onSubmit` performs the op (or pushes the next step for multi-arg
   chains) and closes.
3. **Launch existing UI** — fire a `useNavStore` intent (usually
   `switch-screen`) and `closePalette()`.

Multi-argument actions chain steps. Example — **rename branch**: pick branch →
input new name → run `renameBranch(old, new)`.

### Files

```
features/palette/
├── usePaletteStore.ts   + stack/pushStep/popStep, activeChip, frecency bump
├── commands.ts          NEW — catalog builder; pure-ish, takes store snapshots
├── frecency.ts          NEW — localStorage frecency store + scoring (pure, tested)
├── CommandPalette.tsx    renders the active step (root list+chips | pick | input)
├── fuzzyMatch.ts         unchanged
└── *.test.{ts,tsx}       extended
```

`commands.ts` extraction matters: `CommandPalette.tsx` is already 461 lines.
Pulling the catalog out keeps the component focused on rendering + keyboard
handling, and lets the catalog be unit-tested against store snapshots.

## Command catalog

Comprehensive coverage. Grouped by resolution mode. Items only appear when
applicable (e.g. continue/abort only when an operation is in progress; pop-stash
only when stashes exist).

### Navigation (launch, existing — keep)

Go to Files / Commit / History / Branches / Conflicts / Rebase / Remotes /
Diff viewer / Reflog / Settings (via `switch-screen` intent, as today).

### Direct (zero-arg / inferred context)

| Command | Action | Notes |
|---|---|---|
| Fetch all remotes | `fetchAll()` | exists |
| Refresh repository | `refreshAll()` | exists |
| Pull current branch | `pull(remote, branch, mode)` | smart: if current branch has upstream, direct; else inline pick remote |
| Push current branch | `push(remote, branch)` | smart, same upstream logic |
| Force-push current (with lease) | `push(remote, branch, "with-lease")` | destructive — clear red-flag label; smart upstream |
| Pop latest stash | `stashPop(0)` | only when stashes exist |
| Abort current operation | `abortOperation()` | only when `repoState != "Clean"` |
| Continue current operation | `continueOperation()` | only when `repoState != "Clean"` |

### Inline single-pick / input

| Command | Step chain |
|---|---|
| Checkout branch | pick branch → `checkoutBranch` |
| Checkout tag/ref | pick tag/ref → `checkoutRef` |
| Create branch | input name → `createAndSwitchBranch(name)` (from HEAD) |
| Merge branch into current | pick branch → `mergeBranch` |
| Rebase current onto… | pick branch → `rebaseOnto` |
| Delete branch | pick branch → `deleteBranch` (retry with `force` on failure) |
| Rename branch | pick branch → input new name → `renameBranch` |
| Cherry-pick commit | pick commit → `cherryPick` |
| Revert commit | pick commit → `revert` |
| Reset current branch to… | pick commit → pick mode (soft/mixed/hard) → `reset` |
| Create tag | input name → `createTag(name, { kind: "head" })` |
| Delete tag | pick tag → `deleteTag` |
| Push tag | pick tag → pick remote → `pushTag` |
| Stash changes | input message (empty allowed) → `stashSave` |
| Apply stash | pick stash → `stashApply` |
| Pop stash | pick stash → `stashPop` |
| Drop stash | pick stash → `stashDrop` |
| Stash → branch | pick stash → input branch name → `stashBranch` |

Pick-step item lists are built from live store data (`branches`, `commits`,
`tags`, `stashes`, `remotes`) and reuse the same fuzzy-match + highlight
rendering as the root list.

### Launch existing UI (complex multi-field)

| Command | Target |
|---|---|
| Add remote | Remotes screen |
| Manage remotes (rename / set-url / remove / prune) | Remotes screen |
| Interactive rebase | Rebase screen |

## Hint chips

- Chips rendered as a row under the search input on the **root step only**:
  `All · Commands · Branches · Files · Commits`.
- `activeChip` in `usePaletteStore` (default `"all"`). Filtering happens after
  fuzzy scoring: `all` shows every group (current behavior); any other chip
  shows only that type's group.
- Click a chip to activate. `⌃Tab` / `⌃⇧Tab` cycle chips left/right. The active
  chip resets to `all` whenever the palette opens.
- Chips do not appear inside `pick`/`input` steps (those are already
  type-scoped).

## Frecency & empty state

`frecency.ts` (pure, localStorage-backed, unit-tested):

- Store: `Record<itemId, { count: number; lastUsed: number }>` under
  `localStorage["pg-palette-frecency"]`. Capped (e.g. 200 entries, evict
  lowest-score) to bound growth.
- `bump(id, now)` — called from `activate()` for every executed item.
- `score(id, now)` — frecency weight combining frequency and recency
  (count × recency-decay). Returned as an additive boost folded into the
  existing fuzzy score so frequently-used matches float up.
- `now` is injected (caller passes `Date.now()`) so the module stays pure and
  testable.

**Empty-query root screen** (replaces "Type to search."):

- **Quick actions** for the current branch: Push, Pull, Commit (go to Commit
  screen), Fetch all — shown as a small top section.
- **Recent** — top N items by frecency `lastUsed`, resolved back to live catalog
  items (skip any that no longer exist, e.g. a deleted branch).

When the query is non-empty, scoring + per-type caps + chips apply as today,
with the frecency boost added.

## Error handling

- All ops already return `AppResult` and surface errors through
  `useRepoStore`'s existing error banner; the palette closes on activation and
  errors render in the shell as they do today. No new error surface.
- `input` steps run an optional `validate` before submit (e.g. non-empty branch
  name); the error string renders inline under the input and blocks submit.
- Destructive items (force-push, delete branch, reset --hard, drop stash) get a
  visually distinct (danger-tinted) label. No extra confirm dialog inside the
  palette — they rely on the inline pick being a deliberate multi-step action;
  reset/force-push surface their nature in the label and detail text.

## Testing

- **`frecency.test.ts`** — bump/score/eviction/recency-decay ordering, with
  injected `now`. Pure.
- **`commands.test.ts`** (new) — catalog builder produces expected items for a
  given store snapshot: conditional items appear/disappear (stash items only
  with stashes, continue/abort only mid-operation), smart push/pull resolves
  direct vs inline.
- **`CommandPalette.test.tsx`** (extended) — step navigation (push/pop, Esc and
  empty-Backspace), chip filtering, an inline pick flow end-to-end (open → pick
  command → pick branch → asserts repo action invoked), a direct action, and the
  empty-state quick-actions render. Uses existing `mockInvoke` harness.
- **`fuzzyMatch.test.ts`** — unchanged.

## Out of scope

- Context-aware ranking (boost by active screen) — deferred.
- Prefix-syntax scoping (`>`, `@`, `:`) — chips chosen instead.
- New backend ops — this is purely a frontend surface over existing
  `GitBackend` methods; no Rust changes expected.
- Confirmation dialogs for destructive ops beyond the danger-styled label.
