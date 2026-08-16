# Branch picker: pin the default branch, order the rest by recency

**Issue:** [#135](https://github.com/jonassaa/platypusgit/issues/135)

## Problem

Branch lists are unordered. `Libgit2Backend::branches` (`libgit2.rs:3322`) iterates
`repo.branches(None)` and pushes, so the frontend receives git's ref-iteration
order — refname order, i.e. alphabetical. Nothing downstream sorts:
`BranchPicker.tsx:47-60` filters in place, `screens/Branches.tsx:129` filters and
splits by view, `features/palette/commands.ts:66-72` maps straight to rows.

Consequences in any repo with more than a handful of branches:

- `chore/bump-deps` sits above `main`. The one branch most switches return to is
  wherever the alphabet put it.
- A branch touched five minutes ago sits below one abandoned last year, with no
  signal separating them.
- The popover preselects row 0 and Enter checks it out (`BranchPicker.tsx:30`,
  `:127`), so the alphabetically-first branch is one keystroke from being checked
  out by accident.

`BranchInfo` carries nothing time-shaped and nothing default-shaped, so neither
ordering can be derived on the frontend. `default_branch_name()`
(`libgit2.rs:1930`) is not the missing helper — it reads the **global**
`init.defaultBranch` config to prefill the Init dialog and says nothing about the
repository actually open.

## Design

### A. Two new `BranchInfo` fields

```rust
pub struct BranchInfo {
    // …existing…
    pub tip_time: i64,      // committer time of the tip, seconds since epoch
    pub is_default: bool,   // this ref is the repository's default branch
}
```

Mirrored as `tipTime: number` / `isDefault: boolean` in `src/lib/types.ts` in the
same commit (the 1:1 contract). Both are **required**, not optional: the backend
always emits them, and an optional field would let a `?? 0` creep into the
comparator and hide a missing value as "very old".

`tip_time` costs one `find_commit` per branch off the oid the loop already reads
(`libgit2.rs:3344`), the same cost class as the `graph_ahead_behind` call already
made per local branch. An unresolvable tip (unborn or broken ref — `tip` is
already `Option<String>` for exactly that case) yields `0`, which sorts last.

`tip` itself is untouched. It is a **full** oid and must stay one; nothing here
reads or shortens it.

### B. Default-branch detection

A free function in `libgit2.rs`, run once per `branches()` call, in the issue's
stated priority order:

1. **`refs/remotes/<remote>/HEAD`'s symbolic target.** Git's own answer, written
   by `git clone` and `git remote set-head`. `refs/remotes/origin/HEAD` →
   `refs/remotes/origin/main` → `main`. Remotes are tried `origin` first, then
   the rest alphabetically, so a repo with two remotes answers deterministically.
   A non-symbolic `…/HEAD` (some setups pin it to an oid) names no branch and is
   skipped.
2. **The first of `main`, `master`, `trunk` that exists as a local branch.**
3. **None** — nothing is pinned and the list is pure recency.

Explicitly **not** `init.defaultBranch`: it describes branches that do not exist
yet and would name `main` in a repo whose default is `master`.

The result is a short **branch** name (`main`), not a ref. `is_default` is then
set per row:

- a local branch, when `name == default`;
- a remote branch, when the part after the first `/` equals `default` —
  `origin/main` pins at the top of the Remote section. Splitting on the first
  slash is correct because git forbids `/` in a remote name while allowing it in
  a branch name, so `origin/feature/x` splits as `origin` + `feature/x`.

Two consequences:

- With two remotes, `origin/main` **and** `upstream/main` are both flagged. They
  are both "the default branch, on a remote", they sit adjacent at the top of one
  section, and their relative order falls through to the ordinary rules. Carrying
  a per-remote default to avoid this would add a field nothing else wants.
- **A remote's `HEAD` is accepted only when the ref it names still exists.**
  `git fetch --prune` does not rewrite the symref, so a repository cloned when
  the default was `master` keeps pointing at `refs/remotes/origin/master` forever
  after upstream renames it. Taking that name on trust would suppress case 2 as
  well — the perfectly good local `main` would never be considered and nothing
  would be pinned again, permanently and silently. A dangling symref therefore
  falls **through** to the next remote and then to the local candidates.

### C. One pure comparator, three surfaces

`src/features/branches/orderBranches.ts` — pure, unit-tested, in the style of
`graphLayout` / `buildRebasePlan`:

```ts
export function compareBranches(a: BranchInfo, b: BranchInfo): number;
export function orderBranches<T extends BranchInfo>(rows: readonly T[]): T[];
```

Order: **default first**, then `tipTime` **descending**, then `name` ascending as
the tiebreaker. The tiebreaker uses plain `<`/`>` rather than `localeCompare`, so
the result does not depend on the runtime's ICU data — several branches created
from one commit (`git branch x`, the `manyRefsRepo` fixture) all share a
`tipTime` and would otherwise order differently on different machines.

`orderBranches` is generic over `T extends BranchInfo` so the picker's
`Row = BranchInfo & { kind }` survives the call, and it copies before sorting —
`useRepoStore.branches` is store state and must not be sorted in place.

Adopted by all three surfaces, so a second ordering cannot grow:

| Surface | Where |
| --- | --- |
| `BranchPicker.tsx` | inside the existing `local` / `remote` `useMemo`s, after the filter |
| `screens/Branches.tsx` | the `rows` memo — local and remote ordered **within** their groups, locals still before remotes in the `all` view |
| `features/palette/commands.ts` | `branchItems`, after the optional `filter` |

`orderBranchesGrouped` is the second export, for a surface that renders ONE
undivided list: it orders locals and remotes separately and concatenates. The
picker gets that grouping from its two labelled sections and the Branches screen
from its view split; the palette's pick steps have neither, and without it `main`
and `origin/main` (both `isDefault`) take rows 1-2 and everything below
interleaves by tip time.

**The pin is honoured in three places, and the palette's ROOT step is not one of
them.** `CommandPalette` adds `frecencyScore(...)` to every candidate regardless
of query and bumps frecency on every pick, so as soon as the user has picked any
branch from the palette that branch outranks the pinned default there — sort
stability is irrelevant. That is correct: the root step is a relevance ranking
over four result types, not a branch list. The pick steps, the picker and the
Branches screen are where the ordering is a contract.

`RebaseBasePicker` is deliberately left alone. It builds a mixed
branch/commit/freeform row list under its own relevance rules and is not one of
the three surfaces the issue names; adopting the comparator there is a separate,
larger question about how branches and commits interleave.

### D. Ordering never resurrects a filtered-out row

Every call site filters **first** and orders **second**, and `orderBranches` is a
permutation: same length, same elements, no defaulting and no injection. So a
query that does not match the default branch simply does not show it — the pin
reorders what search already chose, it does not override search. Unit-tested
directly (`orderBranches` of a list with no default returns exactly its input
names) and at the picker level.

### E. Where the cursor starts

`activeIndex` starts at 0 today, so Enter checks out whatever sorts first. After
this change that would be the default branch — a *sharper* accident than the
alphabetical first row, because `main` is a plausible destination and the
mistaken checkout would look intentional.

**The cursor rests on the current branch while the query is empty**, falling back
to row 0 when no row is HEAD (detached HEAD, or a filtered list). Reason:
`checkout()` already early-returns for the HEAD row (`BranchPicker.tsx:106`), so
opening the popover and pressing Enter does **nothing**. That is the only
starting position where the accidental keystroke has no effect at all. First row
and first-non-HEAD row both check something out.

Once a query is typed the cursor moves to row 0, because after typing the top
match *is* what the user is aiming at. This also fixes a latent bug: today
`activeIndex` survives a query change and is only clamped to the new length, so
typing while the cursor sits on row 3 leaves it pointing at an unrelated row.

Resting the cursor on HEAD means it can start below the fold in a long list, so
the active row is scrolled into view when `activeIndex` changes
(`scrollIntoView({ block: "nearest" })` on the row element). The picker's rows
are plainly mapped, not windowed, so the DOM route is sound here — the
`scrollTopForRow` rule applies to the windowed diff surfaces, not to this list.
This also makes ArrowDown past the visible area work, which it never did.

The rule re-runs as the row list changes, not only on open, because the popover
can be opened before `list_branches` resolves; a flag records whether the user
has aimed the cursor themselves (arrows or hover) so re-running never yanks it
out from under them.

**The same argument applies to the other two surfaces, and moving a plausible
destructive target to row 0 is what makes it their problem too.**

- **The Branches screen had a phantom selection.** `flatIndex` clamped
  `findIndex` to 0 while `selection` starts `null`, so `usePaneList` was told row
  0 was selected with NO row rendered as highlighted — and `branches.list` is the
  screen's primary pane, so entering the screen focuses it. Enter checked out row
  0. `flatIndex` now stays `-1`: arrowing either way lands on row 0, and
  `onActivate(-1)` reads past the end of the list and no-ops.
- **The palette's branch pick steps preselected row 0.** `activeIndex` resets to
  0 on every `pushStep`, so "⌘P, delete branch, Enter, Enter" reached
  `deleteBranch("main")` — and `delete_branch` refuses only *unmerged* branches,
  so the default branch (an ancestor of HEAD) deleted, unconfirmed and
  irreversible short of the reflog. A `pick` step may now declare
  `cursor: "none"`, which rests on nothing while its query is empty. Typing still
  moves the cursor to the top match, on the same reasoning as the picker.

  **The flag is set in exactly one place**, `branchPickStep` — the constructor
  every branch step in the catalog is built from (seven of them, including
  #131's two compare steps). Enumerating `cursor: "none"` at each call site
  would leave the rule to be remembered by whoever adds the eighth; a
  constructor makes the natural way to write one correct. `branchItems` stays
  exported for the ROOT step, which builds candidates rather than a step.
- **Deleting a branch from the palette now confirms.** It was the only delete
  path without a `pgConfirm` — the row menu and the Branches inspector both had
  one. Pinning a plausible branch at row 0 is what turned that from an oversight
  into a hazard, and CLAUDE.md mandates the confirm for destructive ops
  regardless.

### F. HEAD does not pin

The current branch stays in recency order. It is already accent-coloured and
badged `HEAD` (`BranchPicker.tsx:192`), it is the one branch the picker exists to
*leave*, and under committer-time ordering it is usually near the top anyway
because it is what you just committed to. Pinning it second would push the actual
default down for no navigational gain and add a second special case to a
comparator whose value is that it has one.

## Testing

- **Rust** (`src-tauri/tests/branches_tags.rs`): `tip_time` is the tip's
  committer time and orders two branches correctly; `is_default` follows
  `origin/HEAD`'s symbolic target, including onto `origin/<name>`; falls back to
  local `main`/`master`; `master` wins over a non-existent `main`; no default
  when none of the three exist and there is no remote HEAD; `init.defaultBranch`
  set to something else changes nothing; a **stale** `origin/HEAD` falls through
  to the local candidate, and pins nothing when there is none.
- **Frontend unit** (`orderBranches.test.ts`): default first; recency descending;
  name tiebreak on equal `tipTime`; input is not mutated; a list without a
  default is a pure recency sort; the output is a permutation of the input (the
  §D guarantee); `orderBranchesGrouped` keeps every local ahead of every remote.
  `commands.test.ts` asserts `branchItems`' order directly — it is pure, unlike
  the rendered palette, whose frecency scoring makes it fragile to pin.
- **Component** (`BranchPicker.test.tsx`): rows render default-first then by
  recency; a query that excludes the default does not resurrect it; the cursor
  starts on the HEAD row with an empty query and on row 0 once a query is typed;
  a branch list that arrives AFTER the popover opened still re-parks the cursor
  on HEAD, and one the user has aimed is left alone.
  `Branches.activate.test.tsx`: Enter with nothing selected checks nothing out,
  and still checks out once a row is genuinely selected.
  `CommandPalette.branchStep.test.tsx`: the Delete step rests on no row, so the
  Enter that opened it cannot fire row 0; aiming a row then confirms before
  deleting. All four fail on the pre-fix code.
- **E2E** (`branches.e2e.ts`): with `manyRefsRepo` (60 `feature/branch-NN`
  branches created from one commit, plus `main`) the first `[data-branch-row]` in
  the picker is `main` — which without the pin would be `feature/branch-00`,
  sixty rows above it.

## Out of scope

- **Reflog-based "last checked out" recency.** It models "branches I'm working
  on" better, but it degrades to one entry on a fresh clone where everything else
  ties, and remote-tracking refs have no useful reflog at all. Committer time is
  what `git branch --sort=-committerdate` means and what every other client shows.
  A blend (reflog order first, committer time for the rest) is a possible
  follow-up.
- Grouping, foldering, or a "recent branches" section.
- A user-configurable sort order.
- `RebaseBasePicker`'s row order (see §C).
- Marking the default branch visually. This is ordering only; the issue is
  explicit that HEAD's existing badge is the only ref decoration in play.
