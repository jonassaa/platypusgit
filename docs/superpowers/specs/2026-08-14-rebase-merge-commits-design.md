# Interactive rebase over merge commits — design

## Problem

A rebase plan that contains a merge commit fails, and it fails after the
branch has already been rewritten.

Measured against the real backend (throwaway probe, repo
`root → A → (feature: F) → C → M`, where `M` merges `feature`; plan =
`pick A, F, C, M`, exactly what the UI builds today):

```
rebase_start  → Err(Git("mainline branch is not specified but a4666829… is a merge commit"))
rebase_status → in_progress: true, next_index: 3, total: 4
HEAD          → eb5042d3 "C on main"   (rewritten copy; branch tip already moved)
repo_state    → Clean
rebase_abort  → Ok, HEAD back to a4666829 M
```

`Libgit2Backend::start_pick` calls `repo.cherrypick(&target, None)`. libgit2
refuses a merge commit without a mainline (`git_cherrypick_commit` requires it,
the same condition git reports as *"is a merge but no -m option was given"*).
The error surfaces on step 4 of 4, so three rewritten commits and a moved
branch tip are already on disk. TortoiseGit shipped this exact bug —
[TortoiseGit #1756](https://gitlab.com/tortoisegit/tortoisegit/-/issues/1756).

Three separate defects hide behind that one symptom:

1. **No pre-flight validation.** The plan is executed before it is checked, so
   an unexecutable plan is discovered mid-rewrite.
2. **Abort-ability is in-memory only.** `RebaseState.orig_head` lives in
   `Libgit2Backend.rebases`; nothing is written to disk, `repo_state` reports
   `Clean` (it mirrors libgit2's `repo.state()`, which reads on-disk state
   dirs). Close the app mid-failure and the branch stays half-rewritten with no
   abort path — reflog only.
3. **The base is computed off the wrong row.** Every context-menu entry point
   uses `commits[idx + 1]` (`src/design/context-menu.tsx:427,464,489`) — the
   next row in a *graph-ordered* log, not the commit's parent. In the probe
   repo, "Interactive rebase from here" on `C` picks base `F` (a side-branch
   commit), so `rebase_start` resets to `A` with a plan of `[C, M]` and **F's
   content is silently dropped**. Independent of merge handling; a correctness
   bug on any non-linear history.

`commitsSince` — the base-picker path, and the primary way into the Rebase
screen — returns the full graph range including side-branch commits and
merges, so any repository whose range contains a merge reaches defect 1
through ordinary use.

## What other tools do

Three patterns, no fourth:

- **git itself** — *"By default, a rebase will simply drop merge commits from
  the todo list, and put the rebased commits into a single, linear branch."*
  `--rebase-merges` recreates the topology through `label`/`reset`/`merge -C`
  todo commands, with documented costs: *"Any resolved merge conflicts or
  manual amendments in these merge commits will have to be resolved/re-applied
  manually"*, `ort` strategy only, `no-rebase-cousins` by default.
  ([git-rebase(1)](https://git-scm.com/docs/git-rebase))
- **GitKraken** — blocks: *"Interactive rebase is not available for merge
  commits"*, *"No merge commits may exist on the source branch."*
  ([docs](https://help.gitkraken.com/gitkraken-desktop/interactive-rebase/))
- **SmartGit** — allows it, warns up front that merge commits *"will be
  flattened and replaced by normal commits"*.
  ([docs](https://docs.syntevo.com/SmartGit/Latest/Manual/GUI/Branch/Rebase-Interactive))
- **TortoiseGit** — preserve-merges behind an explicit warning: *"has known
  bugs as re-ordering commits is not working properly (same limitation as for
  vanilla git rebase)"*.
  ([docs](https://tortoisegit.org/docs/tortoisegit/tgit-dug-rebase.html))
- **JetBrains Rider / IntelliJ** — "Interactively Rebase from Here" is disabled
  when *"the selected commit has several parents"*, is not on the current
  branch, or is pushed to a protected branch, with the reason in the status
  bar; merges *inside* the range are fine, and the rebase dialog exposes
  `--rebase-merges` as a checkbox.
  ([docs](https://www.jetbrains.com/help/rider/Apply_changes_from_one_branch_to_another.html))
- **lazygit** — always passes `--rebase-merges`; its "rebase from here" range
  stops at the first merge commit.

Nobody half-rewrites a branch and then errors. Flattening with a warning is the
common default; preserving is opt-in and universally caveated.

Deviation from JetBrains, decided deliberately: a merge commit **is** a legal
start point here, with its first parent as the base. The plan is built for the
user, so the "which parent" ambiguity is answered rather than dodged.

## Approach

### 1. Execution model — detach, replay, move the branch last

`finish_pick` commits to `HEAD` directly, so the branch tip advances with every
pick. That is why abort needs a remembered tip, and it cannot work at all once
a plan replays a side branch: the branch ref would follow the side branch.

The engine adopts git's model:

- `rebase_start` detaches HEAD at the plan's base, replays there, and updates
  the branch ref only when the plan runs to completion.
- A `rewritten: HashMap<old_oid, new_oid>` map records each step's result.
  Dropped or skipped steps map `old_oid → current HEAD`, so descendants still
  resolve to a real base.
- `rebase_abort` deletes the state and checks the branch back out. The branch
  never moved, so there is nothing to reconstruct.

### 2. Plan shape — structural topology, no label language

git needs `label`/`reset`/`merge <label>` because its todo list is a text file
a human edits. This plan is generated, so topology is encoded structurally and
every commit is implicitly its own label:

```rust
pub struct RebaseStep {
    pub oid: String,
    pub action: RebaseAction,               // + Merge, MainlinePick
    pub message: Option<String>,
    /// Original oid this step applies onto. `None` = onto the previous step's
    /// result (the linear default — every plan built before this change).
    #[serde(default)] pub onto: Option<String>,
    /// Original parents 2..n. `Merge` steps only; empty otherwise.
    #[serde(default)] pub merge_parents: Vec<String>,
}
```

Execution per step: resolve `onto` through `rewritten`, hard-reset the detached
HEAD there when it differs from the current position, apply the action, record
the result. The plan stays a flat ordered list, which preserves drag-reorder,
the `RebaseStatus { next_index, total }` progress contract, and the shape of
the seven existing rebase integration tests (`onto: None`,
`merge_parents: []`).

Correctness does not depend on how rows are grouped: each step names its own
base, so any parents-before-children order executes correctly. Row order stays
the reverse of the existing `TIME | TOPOLOGICAL` walk, which guarantees that.

Not adopted from git, deliberately: user-authored labels, `rebase-cousins`
mode, `exec` steps. A GUI that generates its own plan needs none of them.

### 3. Merge steps — three legal actions

| Action | Semantics | Primitive |
| --- | --- | --- |
| `Drop` (flatten default) | The merge disappears; its side-branch commits are picked individually, producing a linear branch. Identical to plain `git rebase -i`. | existing skip path |
| `MainlinePick` | The merge is kept as one ordinary commit carrying its diff against its first parent and its original message. | `CherrypickOptions::mainline(1)` |
| `Merge` (recreate) | The rewritten parents are re-merged; the result is committed with n parents and the original message. | `repo.merge(&[annotated…])`, then an n-parent commit |

`Merge` uses the **worktree** merge rather than in-memory `merge_commits` so
that conflicts land in the index with stages. That makes a conflicting
recreated merge flow into the existing conflict UI and the Rider-style merge
resolver window unchanged: pause reason `"conflict"`, and `rebase_continue`
commits the resolved tree with both parents. No new conflict surface.

Octopus merges (>2 parents): `Drop` and `MainlinePick` are allowed; `Merge` is
rejected with a plain message. The type carries n parents, so support is a
later fill-in rather than a redesign.

Any action other than these three on a merge commit is a validation error, not
a runtime surprise.

### 4. Durable state — abort survives a restart

`.git/platypusgit-rebase.json`, written atomically (temp file + rename) at
every step transition:

```json
{"version": 1, "headName": "refs/heads/feat/x", "origHead": "<oid>",
 "onto": "<oid>", "remaining": [ /* steps */ ],
 "current": {"step": {/* … */}, "phase": "conflict"},
 "rewritten": {"<old>": "<new>"}}
```

`ORIG_HEAD` is written the way git writes it, so `git reset --hard ORIG_HEAD`
remains a CLI escape hatch. `rebase_status` falls back to the file when the
in-memory entry is missing, and `repo_state` reports the **existing**
`RepoState::RebaseInteractive` variant while the file exists — so the banner,
Continue, and Abort all survive an app restart without a new enum variant or
any TS churn.

Git's own `.git/rebase-merge/` directory is deliberately *not* written. A
half-compatible one would make `git status` and `git rebase --continue` claim
authority over a rebase they cannot drive; a private file plus `ORIG_HEAD` is
honest about who owns the operation.

### 5. Validation before anything moves

`rebase_start` validates the whole plan, then touches the repository. Failures
raise a new `AppError::InvalidRebasePlan(String)`, mirrored into the TS union
in the same commit.

Checks: plan non-empty; no duplicate oids; every oid resolvable; `onto` names
either an earlier step or an existing commit; every commit with >1 parent
carries `Merge`, `MainlinePick`, or `Drop`; `Merge` steps carry ≥1
`merge_parents` and no more than two parents in total; the worktree is clean
(existing check, kept). Each rejection is covered by a test that asserts HEAD
**and** the branch ref are unchanged — that is the defect the probe exposed.

### 6. One continue path, one abort path

There are two ways to resume a paused operation today, and only one of them
knows about the rebase plan. `Libgit2Backend::continue_operation` — what the
Conflict screen and the palette call — writes the staged tree as a commit
(two-parent when `MERGE_HEAD` exists), runs `cleanup_state`, and returns. It
never advances the plan, so resolving a paused pick from the Conflict screen
instead of the Rebase banner commits the resolution and leaves the rebase
stalled with its `conflict_step` still stashed. `abort_operation` already
special-cases the in-memory rebase entry; `continue_operation` does not.

Recreated merges make the divergence worse: a paused `Merge` step has
`MERGE_HEAD` set, so the generic path would commit a plausible-looking
two-parent merge and then drop the rest of the plan on the floor.

So: whenever the rebase state file exists, `continue_operation` delegates to
`rebase_continue` and `abort_operation` delegates to `rebase_abort`, and the
latter reads the state file rather than the in-memory map. One engine, two
entry points.

`repo_state` gives the state file precedence over libgit2's `repo.state()`, so
a paused pick reports `RebaseInteractive` rather than `CherryPick` (which is
what it reports today) and a paused recreated merge reports
`RebaseInteractive` rather than `Merge` — matching what git reports in the same
situation. The Conflict screen's Continue/Abort buttons gate on
`repoState !== "Clean"`, so they keep working unchanged.

### 7. Frontend

- **Mode toggle** in the Rebase toolbar: `Flatten merges` (default, git's
  behaviour) / `Preserve merges`, persisted alongside the other rebase-screen
  preferences.
- `buildRebasePlan` gains the mode. Flatten: merge rows get `Drop`, everything
  else stays linear (`onto: null`). Preserve: each step's `onto` is its first
  parent when that parent is inside the range, merge rows get `Merge` plus
  `mergeParents`.
- **Merge rows** carry a merge badge and a restricted action set — flatten:
  *Drop* or *Squash into one commit* (`MainlinePick`); preserve: *Merge* or
  *Drop*. Reword, edit, squash, and fixup are not offered for a merge.
- **Warning strip** above the plan, following SmartGit and TortoiseGit:
  - flatten — *"2 merge commits will be flattened — the branch becomes
    linear."*
  - preserve — *"Merge commits are recreated. Conflict resolutions and manual
    edits inside them are not preserved and may need redoing. Reordering is
    disabled."*
- **Reordering is locked in preserve mode.** git documents its own reorder
  bugs under `--rebase-merges`; shipping a reorder that silently produces the
  wrong topology is worse than not offering it.
- **Entry points** compute the base as `commit.parents[0]`, never
  `commits[idx + 1]`. A merge commit is an allowed start point (base = its
  mainline parent). "Fixup into parent" and "Squash into parent" stay disabled
  on a merge commit, with the reason carried in the disabled label — the
  pattern `commitMultiMenuItems` already uses for its squash block
  (`"Squash 3 — contains a merge"`).
- **`planCommitSelection` carries the same positional assumption twice** and is
  corrected with the entry points: `baseOid` becomes the oldest selected
  commit's `parents[0]` instead of `commits[max + 1]`, and `contiguous` requires
  the selected rows to form a real first-parent chain rather than merely
  occupying adjacent log rows — on a graph, the neighbouring row is often a
  side-branch commit. The multi-select squash path already refuses a selection
  containing a merge (`hasMerge`), which stays as-is.

## Testing

**Rust integration** (`src-tauri/tests/rebase_merges.rs`, real temp repos):

- flatten (`Drop` the merge) → linear log, side-branch commits present, merge
  gone;
- `MainlinePick` → one ordinary commit whose tree equals the merge's tree and
  whose message is the merge's;
- `Merge` → a commit with two parents that are exactly the rewritten oids, tree
  equal to the original merge's;
- `Merge` with a conflict → pauses with reason `"conflict"`, `conflict_sides`
  is populated, `rebase_continue` after resolution commits a two-parent merge;
- every validation rejection leaves HEAD and the branch ref untouched;
- abort with the in-memory entry dropped (a simulated restart) restores the
  branch from the state file;
- octopus `Merge` is rejected; octopus `MainlinePick` and `Drop` work;
- an `onto` sequence that bounces between mainline and side branch;
- `continue_operation` during a paused rebase advances the plan (and
  `abort_operation` restores the branch) rather than committing and stalling.

**Frontend unit** — `buildRebasePlan` in both modes: `onto` and `mergeParents`
assignment, merge-row actions, base `parents[0]`; `planCommitSelection` base and
first-parent-chain contiguity on a graph where the adjacent log row belongs to a
side branch.

**Component** — warning-strip copy per mode, restricted merge action set,
reorder controls disabled in preserve mode.

**E2E** — extend `e2e/specs/rebase.e2e.ts`: a fixture repo containing a merge;
a flatten run asserts a linear log, a preserve run asserts the merge survives.
Docker only (`pnpm test:e2e:docker`).

## Delivery

Three PRs, each independently useful:

1. **Safety and model** — detached-HEAD execution, durable state file +
   `ORIG_HEAD` + `repo_state` reporting, `continue_operation` /
   `abort_operation` delegation, pre-flight validation, the `parents[0]` base
   fix. No new user-facing capability; the existing rebase tests stay green.
2. **Flatten mode** — merge badges, restricted actions, warning strip,
   `MainlinePick`.
3. **Preserve mode** — `onto` / `merge_parents`, the `Merge` action, conflict
   pause into the merge resolver, the mode toggle, the reorder lock.

## Out of scope

User-authored labels; `rebase-cousins`; `exec` steps; autosquash; recreating
octopus merges; preserving the conflict resolutions recorded inside an original
merge commit (git does not either — it re-runs the merge).
