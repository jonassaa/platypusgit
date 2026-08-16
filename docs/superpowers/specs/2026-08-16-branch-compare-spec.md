# Branch compare — ref↔ref and ref↔working tree

**Issue:** [#131](https://github.com/jonassaa/platypusgit/issues/131)

## Problem

Every diff surface in the app answers one of two questions: "what did this
commit change" (`diff_commit`, `diff_commits`) or "what has changed since HEAD"
(`get_diff`'s fixed HEAD↔index↔worktree triple). Nothing answers **"what is on
`feature/x` that is not on `main`"** — the one question a review workflow starts
with.

Three concrete gaps:

1. **No entry point names two refs.** `commit-vs-commit` exists but is reachable
   only from History's two-commit selection (#54). `branchMenuItems`
   (`design/context-menu.tsx`) offers check out / merge / rebase / pull / push /
   rename / set upstream — no compare.
2. **Branch↔working tree has no backend op at all.** Comparing an arbitrary ref
   to what is on disk right now needs `diff_tree_to_workdir_with_index` against
   that ref's tree; every existing path is tree-to-tree or the fixed triple.
3. **Ahead/behind is upstream-only.** `graph_ahead_behind` is called once, for a
   branch against *its own* upstream, and lands in `BranchInfo.ahead`/`behind`.
   An arbitrary pair cannot be counted, and neither can the two commit lists that
   make the counts actionable.

`diff_commits` already resolves both sides with `revparse_single(…)?.peel_to_commit()`,
so it takes `main`, `origin/main` or `v1.2.0` today — only its callers are
oid-only. That half is free. The rest is not.

## Design

### A. Its own screen, not a fourth `Target` in `CommitDiff`

`screens/CommitDiff.tsx` was the obvious host and is the wrong one. It becomes a
new deep-view screen, `compare` (`screens/Compare.tsx`), for four reasons:

- **`Target` is oid-shaped end to end.** All four of its cases carry an oid, and
  `targetHeader`, the fetch, `verifyOid` and `syntaxSides` each switch on that.
  "Working tree" has no oid; every one of those four sites would grow a third
  branch to say so.
- **CommitDiff is fire-once, compare is interactive.** CommitDiff reads an
  immutable `NavIntent`, clears it, and never changes target again. Compare owns
  two *mutable* sides, a swap, and a manual re-read (the working tree moves under
  it). That is state none of CommitDiff's targets has ever needed.
- **The commit lists want the room, and the panes.** `CommitDiffPanel` already
  claims two focus panes (`<prefix>.files`, `<prefix>.view`). The two commit
  lists (`a..b` and `b..a`) are two more. Four panes with a ref bar on top is the
  compare view's shape, not the commit-diff view's.
- **Cost of the split is near zero.** Compare *mounts* `CommitDiffPanel` for its
  file diff, so the `flattenDiffRows` → `PGWindowedDiff` pipeline, word spans,
  syntax, prefetch and F7 all come along unchanged, and `commitDiff` keeps its
  exact behaviour and its five existing test files.

`compare` joins `DEEP_VIEWS` — reachable only through a nav intent, with
`DeepViewHeader`'s Back, and no activity-bar slot. No activity-bar entry on
purpose: like submodules/worktrees, a *conditional* slot would move the bar's
geometry under the user, and unlike them compare is not a place you idle in.

### B. The two sides

```ts
type CompareSide =
  | { kind: "rev"; rev: string }   // branch, remote branch, tag, oid, any revspec
  | { kind: "workdir" };           // right side only
```

`left → right`, the same direction `commit-vs-commit` already reads
(`from → to`), so a change that exists only on the right renders as an addition.

| left | right | summary | commit lists | file diff |
| --- | --- | --- | --- | --- |
| rev | rev | `ahead_behind(l, r)` + merge base | `l..r` and `r..l` | `diff_commits(l, r, …)` |
| rev | workdir | — | — | `diff_ref_to_workdir(l, …)` |

**The working tree is a right-hand side only.** It is not a commit: it has no
ancestry, so `l..workdir` is not a thing git can count or walk, and putting it on
the left would only produce a reversed patch nobody asked for. So with `workdir`
selected the summary row and both commit lists are *absent*, not empty — a "0
commits ahead" line about a working tree would be a lie dressed as a fact.

**Default sides** when the screen is entered without a payload: left = the
current branch (`HEAD` when detached or unborn), right = working tree. That is
the app's own `git diff`, so the screen is never blank, and both chips are one
click from anything else.

### C. Untracked files on the working-tree side — included, and said out loud

Git's own `git diff <ref>` ignores untracked files. This view includes them, and
the primitive takes the knob explicitly rather than hardcoding either answer:

```rust
fn diff_ref_to_workdir(
    &self, repo_id: &RepoId, revspec: &str,
    context_lines: u32, ignore_whitespace: bool, include_untracked: bool,
) -> AppResult<Vec<FileDiff>>;
```

Reasoning, in the order it decided the call:

- **The app is already not git here.** `libgit2.rs::diff`'s `WorktreeToIndex` and
  `WorktreeToHead` set `include_untracked(true).recurse_untracked_dirs(true).show_untracked_content(true)`,
  which is why a newly created file has a readable diff in the Files and Commit
  screens. Excluding it here would make ref↔working-tree the *only* worktree diff
  in the app that hides a file you just wrote — an inconsistency inside the
  product is worse than a divergence from the CLI.
- **The failure modes are not symmetric.** Excluding fails *silently*: someone
  comparing `main` to their tree before committing sees nothing for the new
  module — the exact case the view exists for. Including fails *visibly and
  boundedly*: some extra all-added entries, and `.gitignore`d files are still
  out, because `DiffOptions::include_ignored` stays false.
- **It is stated, not assumed.** The right-hand chip reads `Working tree` with a
  dimmed `+ untracked` note, so nobody has to infer the semantics from the
  result.

The flag stays on the trait because #133 (stash work) inherits this primitive and
may want git's exact semantics for a stash comparison; that is a caller's
decision, not the primitive's.

**And the untracked side is bounded, because its scope is not `diff`'s.** The
consistency argument above is true but incomplete on its own: `diff` sets
`opts.pathspec(path)` *before* enabling untracked content, so it only ever reads
one file. This op walks the whole tree. So it returns
`WorkdirDiff { files, untracked_omitted }` — over `MAX_UNTRACKED_FILES` (200) the
untracked side is dropped whole and the count is reported, and `MAX_WORKDIR_BLOB`
(5 MiB) caps per-blob size. The decision is made from a names-only counting pass,
before any blob is read, so the files that get dropped are never loaded.

### D. Backend: three additive ops, no rewrites

Standard path each (trait → `Libgit2Backend` → `CliBackend` stub → thin command →
`invoke_handler!` → TS type + wrapper).

1. **`diff_ref_to_workdir`** (above). Resolves `revspec` through
   `revparse_single(…)?.peel_to_tree()` — commit, branch, tag or tree — mapping a
   failure to `InvalidRef(revspec)` like `list_files_at_rev` does, then
   `diff_tree_to_workdir_with_index`. **`_with_index`, not `diff_tree_to_workdir`:**
   the latter ignores the index, so a staged-then-reverted-in-worktree file would
   read as unchanged against the ref. Renames via `find_similar`, same as its
   neighbours. Deliberately general — arbitrary revspec, the same
   `context_lines` / `ignore_whitespace` knobs every other diff op takes — because
   it is a shared primitive, not branch compare's private helper.

2. **`ahead_behind(repo_id, a, b) -> AheadBehind`**, where

   ```rust
   pub struct AheadBehind { pub ahead: usize, pub behind: usize, pub merge_base: Option<String> }
   ```

   `ahead` counts commits reachable from **`b`** and not from `a`; `behind` is the
   mirror. That is `git rev-list --left-right --count a...b` with left = behind
   and right = ahead — i.e. "how `b` stands relative to `a`", which is the only
   reading that matches `BranchInfo.ahead/behind` (a branch against its upstream).
   `merge_base` rides along because it is the same graph query and unrelated
   histories are otherwise indistinguishable from "everything diverged": libgit2
   answers `NotFound`, which becomes `None`, not an error.

3. **`commits_between(repo_id, base, tip, limit) -> Vec<CommitInfo>`** — the
   `base..tip` walk, newest-first, `refs` populated from the same ref map `log`
   uses.

   Not `log` with a fancier refspec: `push_log_start` resolves through
   `revparse_single`, and libgit2 rejects a range spec there
   (`GIT_EINVALIDSPEC`), so `"main..feature"` can never reach a walk that way.
   Not `commits_since` either — that one **requires `base` to be an ancestor of
   HEAD** and errors otherwise, which is correct for a rebase base and exactly
   wrong for two diverged branches, the case compare exists to show.

`AheadBehind` is the only new wire type; it needs its TS twin in `lib/types.ts`
the same commit. No new `AppError` variants: `InvalidRef` already covers every
new failure.

### E. Entry points

A shared `compareMenuItems(ref, { isCurrent })` in `design/context-menu.tsx`,
spliced into both `branchMenuItems` and `remoteBranchMenuItems`, yields:

- **Compare with current branch** — `left = current, right = this ref`, so the
  ref's own work reads as additions. Disabled on the current branch itself.
- **Compare with working tree** — `left = this ref, right = workdir`.
- **Mark for compare** / **Compare with `<marked>`** — the pair that covers an
  arbitrary pair of refs (`left = marked, right = this ref`). The second item
  only appears once something is marked and is disabled on the marked ref itself.

The mark pair stands in for the issue's "two-row selection on the Branches
screen". The Branches screen has a single `Selection`, not History's multi-select
model (`lib/selection.ts` + range clicks + a multi-row menu), so mirroring it is a
selection-model change to a screen this feature otherwise does not touch. The
mark idiom reaches the same destination — any local branch, remote branch or tag
against any other — with no new selection machinery, and it works *across* the
three lists, which a row-range selection would not. The mark lives in the compare
store, not `useRepoStore`: it is a compare-feature scratch value, not per-repo
state, and `RepoSlice` stays untouched.

Palette gains **Compare refs…** (pick a branch → against current) and **Compare
with working tree…** (pick a branch → against the tree). No keyboard chord: the
⌘1–9 row is full, every catalog action must be bound in both presets, and compare
is a considered action, not a hot path.

### F. What the screen does not do

- **No staging, by construction.** Compare mounts `CommitDiffPanel`, which has no
  Stage/Discard affordance at all — the same gate `commit-vs-commit` relies on.
  Even for the working-tree side, where staging *would* be meaningful, the
  read-only panel is the right call for now: hunk indices are only valid against
  the `WorktreeToIndex` diff the Commit screen fetches, not against a diff whose
  old side is an arbitrary ref.
- **No pagination on the commit lists.** They are capped (`COMPARE_COMMIT_LIMIT
  = 200` each) with a "showing first N" note. The counts above them come from
  `ahead_behind`, which is exact regardless of the cap, so a truncated list never
  produces a wrong number.
- **No auto-refresh.** The working-tree side goes stale the moment the user saves
  a file; a manual refresh button says so honestly, where a poll would fight the
  windowed diff.
- **No three-dot diff — but the screen says so.** The commit lists are two-dot
  each way while the file diff is `diff_commits`, tree against tree, so the base
  side's exclusive work appears as deletions that nothing deleted. Leaving that
  unsaid made the screen contradict itself, so the bar carries a
  `diffBasisNote` whenever `behind > 0`, with the full explanation on its
  tooltip. Three-dot remains out of scope; being silent about the difference
  does not.

## Testing

- **Rust** — `src-tauri/tests/ref_compare.rs`: `diff_ref_to_workdir` sees staged,
  unstaged and untracked changes with the flag on and drops the untracked one with
  it off; ignores `.gitignore`d files either way; accepts a branch name and a tag;
  `InvalidRef` on garbage. `ahead_behind` on two diverged branches both ways, on
  an ancestor pair, and on unrelated histories (`merge_base: None`).
  `commits_between` in both directions on the diverged pair, honouring `limit`,
  with no ancestry requirement — the assertion that separates it from
  `commits_since`.
- **Frontend logic** — `features/compare/compareSides.test.ts`: side labels,
  header text, the "workdir cannot be the left side" invariant, and
  `swapSides` (which must refuse to move `workdir` left).
- **Frontend component** — `screens/Compare.test.tsx`: rev↔rev renders the
  summary and both commit lists and calls `diff_commits`; rev↔workdir renders
  neither list and calls `diff_ref_to_workdir` with `includeUntracked: true`;
  swap flips the header and re-fetches; a backend error renders in place instead
  of the banner. `AppShell.screens.test.tsx` gains `compare` to its screen sweep.
- **E2E** — none added in this change. The screen exposes stable
  `data-testid`s (`compare-bar`, `compare-side-left/right`, `compare-swap`,
  `compare-summary`, `compare-ahead-list`, `compare-behind-list`) so a spec is a
  small follow-up, but an unverifiable spec on a required check is worse than no
  spec.

## Out of scope

Staging from the compare view. Pagination / infinite scroll on the commit lists.
Comparing across repositories or against a stash (#133 owns the stash side and
inherits `diff_ref_to_workdir`). A three-dot (`a...b`, merge-base-relative) diff
mode — `diff_commits` is two-dot and the summary already names the merge base.
Per-file compare (that is FileHistory's job). Tag context-menu entries, which can
follow once the branch pair proves the shape.
