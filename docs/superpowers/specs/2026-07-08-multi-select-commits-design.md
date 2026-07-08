# Multi-Select Commits — Design

Status: approved 2026-07-08 (issue #54, spun out of #25)

## Problem

The History commit list is strictly single-select (`selected: number`). You
can't see a **combined diff** of several commits, cherry-pick a handful onto
the current branch in one action, or squash a contiguous range into one
commit. Multi-file selection already shipped for the working tree (#25 /
`2026-07-03-multi-file-select`); commits deserve the same.

## Scope

Frontend + one store action. No new Tauri command and no Rust change: the
backend already has everything.

- **Combined diff** — `diffCommits(repoId, from, to, ctx)` does a plain
  tree-to-tree diff (`git diff from to`). For "everything these N commits
  changed" pass `from = parent-of-oldest`, `to = newest`. Routed through the
  existing `commit-vs-commit` nav intent → CommitDiff screen (same panel used
  today for single-commit diffs).
- **Cherry-pick a set** — the single `cherry_pick(oid)` op auto-commits on a
  clean apply and returns `ConflictsDetected` (leaving conflicted state) on
  conflict. A set is a store-level loop over that op, oldest→newest; a
  conflict stops the loop and surfaces via the existing Conflict screen. No
  batched backend op needed.
- **Squash a contiguous range** — driven entirely through the existing
  `rebase_start` engine. `rebase_start` resets to the first step's parent and
  replays a plan; its Squash action re-parents each squashed commit onto the
  previous one. So a plan of `[Pick oldest, Squash …rest, Pick …newer]`
  collapses the selection into one commit. Reuses the `rebase-plan` nav intent
  → Rebase screen (review + run + conflict/continue), exactly like the
  existing single-commit "Squash into parent" menu item.

Out of scope: batched-cherry-pick *resume* after a mid-set conflict (resolving
the conflict commits that one pick; remaining picks are not auto-continued —
documented, matches the "stop-and-surface" requirement); multi-select in other
commit lists (FileHistory, Reflog); drag-select.

## Selection model

Reuse the pure `src/lib/selection.ts` helper (`Selection { keys; anchor }`,
`clickSelection`, `pruneSelection`, `primarySelectedKey`) unchanged — keys are
commit **oids**. Classic desktop semantics:

- **Plain click** — select exactly that commit, anchor moves to it.
- **Cmd/Ctrl-click** — toggle the commit in/out; anchor handoff per the helper.
- **Shift-click** — contiguous range of *visible* rows between anchor and the
  clicked row.
- **Keyboard** — plain ↑/↓ move a single cursor (collapse to one, unchanged);
  **Shift+↑/↓** extend the range from the anchor. Home/End unchanged.
- **Pruning** — when `visible` changes (search, filter, refresh, repo switch),
  drop selected oids that vanished; a dropped anchor re-homes to the last
  surviving selection. Replaces today's `setSelected(0)` reset effect.

The **primary** commit (`primarySelectedKey`, anchor-or-last) drives the
existing detail pane, so single-selection behavior is unchanged.

**Selection order lives in `visible` (the filtered list); ancestry decisions
live in the full log.** The user selects rows in the filtered `visible` list,
but contiguity, oldest/newest, and the rebase base must be computed against the
store's full `commits` (real ancestry) — else hiding merges could make two
rows look adjacent when a commit sits between them. `planCommitSelection`
(below) does this.

## planCommitSelection (pure, tested)

`src/features/commits/planCommitSelection.ts`:

```ts
interface CommitSelectionPlan {
  oids: string[];          // selected, oldest→newest, filtered to those in the log
  oldestOid: string;
  newestOid: string;
  baseOid: string | null;  // parent of oldest (commits[oldestIdx+1]); null if root/not-loaded
  contiguous: boolean;     // selected indices form one consecutive run in the log
  hasMerge: boolean;       // any selected commit has >1 parent
}
planCommitSelection(commits: CommitInfo[], selectedOids: Iterable<string>): CommitSelectionPlan | null
```

`commits` is newest-first (larger index = older). Returns `null` for an empty
selection. Everything downstream reads this: combined diff uses
`baseOid ?? oldestOid` → `newestOid`; cherry-pick set uses `oids`; squash needs
`contiguous && !hasMerge && baseOid != null`.

## buildRebasePlan — squash-range mode

Add a third mode to the tested `buildRebasePlan`:

```ts
| { kind: "squash-range"; oids: string[]; message: string }
```

Over commits newer than `fromOid` (= `baseOid`), the oldest oid in the set
stays `Pick`, every other selected oid becomes `Squash` carrying `message`, and
commits newer than the set stay `Pick`. Backend Squash re-parents onto the
previous commit, so the chain collapses to one commit with `message`, then the
newer picks replay on top. Same `fromOid ∉ commits → null` guard as today.

## UI

Both surfaces adapt to the selection, mirroring multi-file-select:

- **Detail pane / action row** (`CommitActionRow`): 1 selected → today's
  buttons (Branch here, Tag, Cherry-pick, Revert, Copy SHA). 2+ selected → a
  multi summary ("N commits selected") + multi actions: **View combined diff**,
  **Cherry-pick N commits**, **Squash N commits…** (disabled with a titled
  reason when non-contiguous / contains a merge / base not loaded), **Copy N
  SHAs**. Single-only actions (Branch/Tag/Revert-one) are hidden for 2+.
- **Context menu**: right-click a row inside the multi-selection → a
  `commitMultiMenuItems` menu (same actions). Right-click outside the selection
  collapses to that row and shows the existing single `commitMenuItems`.

Destructive/history-rewriting actions confirm first (squash goes through the
Rebase screen's existing review-then-run; cherry-pick set confirms the count).
On failure, refresh-then-error per the `useRepoStore` catch-arm convention.

## Store

One new action:

```ts
cherryPickMany(oids: string[]): Promise<void>
```

Loops the raw `cherryPick(repoId, oid)` tauri wrapper oldest→newest, refreshes
once at the end. Catch arm: `refreshAll()` then `set({ error })` (refresh-first,
so refreshAll's own `error: null` doesn't wipe it) — a conflicted pick leaves
the repo in a `CherryPick` state the Conflict screen picks up.

## Testing

- `planCommitSelection.test.ts` — ordering, base (incl. root/not-loaded null),
  contiguity over the true log vs a filtered selection, merge detection, empty.
- `buildRebasePlan.test.ts` — squash-range: oldest Pick, rest Squash w/ message,
  newer commits Pick, unknown base null.
- `src/lib/selection.test.ts` already covers the selection helper.
- `History.multiselect.test.tsx` — ctrl-click toggles, shift-click ranges,
  Shift+↓ extends via the keymap, 2+ selection shows multi action row, "View
  combined diff" fires `commit-vs-commit`, cherry-pick N confirms then calls
  the store, squash disabled for a non-contiguous selection.
- `useRepoStore` test — `cherryPickMany` issues N `cherry_pick` invokes in
  oldest→newest order and stops on the conflicting one.
- Existing `History.keyboard.test.tsx` (single-select nav) must stay green.
- **E2E** (`history-ops.e2e.ts`): building the multi-selection uses a plain
  row click (focuses the pane) + `jsChord("Shift+ArrowDown")` (the embedded
  driver can't synthesize modifiers, so we dispatch the chord through the real
  keymap listener). Two cases: *combined diff* of a 2-commit selection lists
  the introduced file; *multi cherry-pick* of two `feature` commits lands both
  on `main` oldest→newest (`multiCherryRepo` fixture). Backend ops themselves
  (`diff_commits`, `cherry_pick`) thus get end-to-end coverage against real
  libgit2.

Gates: `pnpm tsc --noEmit`, `pnpm test`, `pnpm vite build`,
`pnpm exec tsc -p e2e/tsconfig.json --noEmit`,
`pnpm test:e2e:run --spec e2e/specs/history-ops.e2e.ts`.
