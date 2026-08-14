# Submodules, LFS, linked worktrees, bisect

**Issue:** [#93](https://github.com/jonassaa/platypusgit/issues/93) (spun out of [#61](https://github.com/jonassaa/platypusgit/issues/61) D12)

## Problem

Four capabilities every competitor ships and this app has none of. They are grouped
here because #61's audit grouped them, not because they share a mechanism — each
gets its own section below, its own backend module, and its own place in the UI.

Today:

- **Submodules** — nothing but `clone_repo`'s `recurseSubmodules` flag. A repo with
  submodules shows a directory row the app cannot diff, blame or explain: `status`
  reports the gitlink, `is_embedded_repo` deliberately excludes registered
  submodules from the embedded-repo guard (`libgit2.rs:816`), and then nothing else
  ever mentions submodules again. So a submodule row is the one row in the Files
  screen with no story at all.
- **LFS** — nothing. `git/cli.rs` (`CliBackend`) exists precisely as the seam for
  ops libgit2 cannot do, names LFS in its own doc comment, and is 100% stub. A diff
  of an LFS-managed file today renders the *pointer text* as an ordinary three-line
  text diff, which is actively misleading: it looks like the file changed by three
  lines.
- **Worktrees** — nothing, while this project's own development workflow mandates
  one worktree per session (CLAUDE.md).
- **Bisect** — `RepoState::Bisect` is *recognised* (`types.rs:293`, mapped from
  `git2::RepositoryState::Bisect`) and `OperationBar` even has a label for it
  (`opTitle`), but the bar classifies it `opaque`: label plus Abort, and Abort is
  `abort_operation`, which hard-resets to HEAD — mid-bisect that is a detached
  commit, so the one action offered leaves the user worse off than doing nothing.
  There are no start/good/bad/skip/reset ops at all.

## Design

### Shared decisions

**libgit2 vs the git CLI, per operation.** The rule from CLAUDE.md is libgit2 where
it does the job well, `git` where it does not, and a comment at the call site saying
which and why. Applied:

| Operation | Impl | Why |
| --- | --- | --- |
| submodule list / status | libgit2 | `Repository::submodules()` + `submodule_status()` give exactly the four states we want, from config + index + workdir, with no subprocess on a hot path. |
| submodule init | libgit2 | `Submodule::init` writes `submodule.<name>.url` into `.git/config`. Pure local config. |
| submodule sync | libgit2 | `Submodule::sync` copies `.gitmodules` URLs into `.git/config` (and the submodule's own `origin`). Pure local config. |
| submodule **update** | **git CLI** | Updating fetches from the submodule's remote when the recorded commit is missing. libgit2's `Submodule::update` takes `FetchOptions`, but this app's entire credential story is the askpass shim (`GIT_ASKPASS` → our own exe, secret in the environment — `commands/net.rs`), which only exists for a **subprocess** git. Driving libgit2's fetch here would be a second, credential-blind network path. `git submodule update` also recurses correctly in one call. |
| worktree list | libgit2 | `worktrees()` + `find_worktree()` + `Repository::open_from_worktree()` give name/path/lock/prunable/branch with no parsing of `--porcelain`. |
| worktree add | libgit2 | `git_worktree_add` writes the same admin files git does; `WorktreeAddOptions::reference` covers "existing branch" and its absence covers "new branch named after the worktree". |
| worktree lock / unlock / prune | libgit2 | Direct 1:1 API. Prune-all is "prune every prunable worktree", which is what `git worktree prune` is. |
| worktree **remove** | **git CLI** | libgit2 has no `remove`; the nearest thing is `git_worktree_prune` with `WORKING_TREE`, which deletes the directory **without git's dirty check**. `git worktree remove` refuses on uncommitted work unless `--force`. Losing a user's uncommitted work to a "remove" button is not a trade worth making, so this one shells out and the refusal is surfaced as `DirtyWorktree` with an explicit force path. |
| LFS everything | **git CLI** | libgit2 has no LFS at all. This is the case `CliBackend` was created for. |
| bisect everything | **git CLI** | libgit2 has no bisect API whatsoever (no `git_bisect_*`). |

**Where shell-outs live.** Sync `std::process::Command` inside `Libgit2Backend`,
exactly like the existing `run_rebase_flag`, so they stay ordinary `GitBackend`
trait methods and stay covered by `cargo test` against real temp repos. Only the
operations that can hit the **network** (`submodule_update`, `lfs_fetch`,
`lfs_pull`) additionally get a command-layer path through
`net::run_git_authenticated`, following the fetch/pull/push precedent — those are
commands with a pure, unit-tested argument builder, not trait methods.

**`CliBackend` stays a stub.** It gets `NotImplemented` bodies for the 14 new trait
methods, per the standard path. Reviving it as a real backend is a separate job; the
LFS/bisect shell-outs live in `Libgit2Backend` because they need the same opened
`Repository` (workdir, `.git` dir, index) every neighbouring method already has.

### A. Submodules

`SubmoduleInfo { name, path, url, branch, head_oid, workdir_oid, state }`, with
`state: SubmoduleState` collapsing `git2::SubmoduleStatus`'s 13 bits into the four
things a user can act on:

| State | Bits | Means | Offer |
| --- | --- | --- | --- |
| `Uninitialized` | `WD_UNINITIALIZED` | declared, never checked out | **Init**, Update |
| `OutOfSync` | `INDEX_MODIFIED` \| `WD_MODIFIED` \| `WD_ADDED` \| `WD_DELETED` | workdir HEAD ≠ the gitlink the superproject records | **Update** |
| `Modified` | `WD_INDEX_MODIFIED` \| `WD_WD_MODIFIED` \| `WD_UNTRACKED` | right commit, dirty inside | Open as repo |
| `UpToDate` | none of the above | | Sync URL, Open as repo |

Order matters: uninitialized wins over everything (nothing else is meaningful), then
pointer mismatch, then internal dirt. A submodule can be both out of sync *and*
dirty; the row names the more actionable one and the tooltip carries the raw flags.

**Reconciling with `embedded`.** `FileStatus` gains `submodule: bool`, the exact
complement of the existing `embedded: bool`: `is_embedded_repo` already returns
false for a nested repo that `.gitmodules` declares with a URL
(`is_registered_submodule`), so the two flags are mutually exclusive by
construction, and the gitlink that `splitSelection` buckets as "embedded" today is
*not* a submodule's. Both listings (`status`, `list_all_files`) compute it from the
same cheap signals `listed_entry_is_embedded_repo` uses (trailing slash or a
`160000` index entry) plus one `.gitmodules`-derived path set built **once per
listing, and only when `.gitmodules` exists** — so a repo without submodules pays
nothing on the hottest path in the app.

A submodule row therefore stops being a mystery directory: the file-tree row shows
the submodule glyph and its short gitlink oid instead of a folder, its context menu
is `submoduleMenuItems` (Init / Update / Sync / Open as repository / go to the
Submodules screen) rather than `fileMenuItems`, and staging it stays legal — an
updated pointer is an ordinary commit.

**Screen.** `screens/Submodules.tsx`, activity bar entry, one `<PGPane primary>`
holding the list. Rows carry path, state pill, url, and recorded vs checked-out
oid. Header actions: **Init all**, **Update all** (with a recursive toggle), **Sync
URLs**. `Open as repository` calls the existing `openRepo` on the submodule's
absolute path — no new backend op.

### B. LFS

`LfsStatus { installed, version, in_use, patterns, files }`.

- **`installed`** — `git lfs version` exits 0. Everything else in the panel is
  disabled when false, and the ops raise `AppError::LfsUnavailable` rather than
  letting git's *"'lfs' is not a git command"* reach a banner. A missing binary is a
  **state**, not an error.
- **`in_use`** — computed by us from every `.gitattributes` in the worktree
  (root plus subdirectories, plus `.git/info/attributes`), looking for
  `filter=lfs`. Deliberately not `git lfs track`: `in_use` must be answerable with
  the binary absent, which is exactly the case where the user needs to be told
  "this repo needs git-lfs and you do not have it".
- **`patterns`** — the pattern half of those same attribute lines.
- **`files`** — `git lfs ls-files`, parsed into `LfsFile { path, oid,
  materialized }`. `git lfs ls-files` marks a materialized object `*` and a
  pointer-only one `-`; that single call answers "pointer vs materialized" for the
  whole worktree. Empty when the binary is missing.

**Pointer diffs must not look like text diffs.** `FileDiff` gains `lfs:
Option<LfsDiff>` (`{ old: Option<LfsPointer>, new: Option<LfsPointer> }`), filled
by a **pure** post-processing pass over the diff the backend already produced: an
LFS pointer is a ≤3-line text file (`version https://git-lfs.github.com/spec/v1`,
`oid sha256:…`, `size N`), so the whole pointer is inside the diff's own `+`/`-`
lines and no extra I/O is needed. `binary` is deliberately **not** overloaded — it
means "libgit2 says the blob is binary" and other code trusts that. Instead the
four diff surfaces (Diff screen, commit panel, repo browser, commit-diff panel)
gate their text rendering on a shared `isTextualDiff(diff)` (`!binary && !lfs`) and
render one shared `LfsDiffNotice` — old size → new size, short oids — in place of
the pointer text.

**Panel, not a screen.** LFS lives as a section on the **Remote** screen. `git lfs
fetch/pull` are remote-object transfers whose endpoint is derived from the remote
URL; the Remote screen is where remote plumbing already lives, and a third
activity-bar entry that is empty for most repos would be worse. Buttons: **Fetch
objects**, **Pull objects**, **Checkout** (materialize pointers already
downloaded), each disabled with a reason when `installed` is false.

`lfs_fetch`/`lfs_pull` go through `net::run_git_authenticated` with the same
prompt-less-then-credentialed retry as fetch/pull/push, so an LFS server behind
HTTPS auth raises the same `Auth` challenge the rest of the app already handles.
`lfs_checkout` is local.

### C. Linked worktrees

`WorktreeInfo { name, path, branch, head_oid, locked, lock_reason, prunable,
is_current }`.

`is_current` compares the entry's path with the open repository's workdir, so a
user who opened the app *in* a linked worktree can see which row they are standing
in. Only **linked** worktrees are listed — that is what `git_worktree_list` returns
and what the feature is about; the main worktree is the repo itself and is named in
the status bar already.

- **Add** — a `PGModal` asking for the directory (via the dialog plugin's folder
  picker, same as Open repository), then new-branch-name *or* existing branch. The
  worktree's git-visible **name** is derived from the directory basename, which is
  what `git worktree add` itself does.
- **Remove** — `pgConfirm` (`danger`, names the path), then `git worktree remove`.
  A refusal on uncommitted work comes back as `DirtyWorktree`, and the UI then
  offers a second, `requireText`-gated confirm that passes `--force`. Two gates,
  because the first one is about the admin files and the second is about someone's
  unsaved work.
- **Lock / unlock** — lock takes an optional reason via `pgPrompt`; the reason is
  shown on the row and is what stops `prune` from touching it.
- **Prune** — prunes every prunable worktree (a directory that has been deleted
  behind git's back) and reports the names, behind a confirm.

**Never the repo under test.** Every worktree test builds its own `TempRepo` and
adds the linked worktree in a sibling tempdir. Nothing in the suite may point at
the checkout it is running in — this repository is itself developed through
`.claude/worktrees/`, and a `worktree remove` test aimed at the wrong path would
delete another session's work.

**Screen.** `screens/Worktrees.tsx`, activity bar entry, one `<PGPane primary>`.

### D. Bisect

**Git's own on-disk state is the only state of record.** No
`.git/platypusgit-bisect.json`. The rebase engine's state file exists because the
app *drives* that replay itself and git cannot finish it; bisect is the opposite —
every transition is a `git bisect` invocation, git owns `BISECT_START`,
`BISECT_LOG`, `BISECT_TERMS`, `BISECT_EXPECTED_REV` and `refs/bisect/*`, and a
parallel file could only ever disagree with it. That disagreement is exactly the
trap CLAUDE.md documents for `rebase_state.rs`, read from the other direction.

`RepoState` needs **no new variant**: `RepoState::Bisect` already exists and
libgit2's `Repository::state()` already reports it off `BISECT_LOG`, so an
in-progress bisect is announced correctly the moment the ops exist and survives a
restart for free. What was missing is the detail and the actions.

`BisectStatus { in_progress, start_ref, bad_term, good_term, current_oid,
remaining, steps, first_bad_oid, good_count, bad_count, skipped_count }`:

- `in_progress` short-circuits on `.git/BISECT_LOG` not existing — one
  `Path::exists()`, so polling it alongside `repo_state` on every refresh costs
  nothing in the 99.9% case.
- `bad_term`/`good_term` come from `BISECT_TERMS` (line 1 = bad/new, line 2 =
  good/old), so a bisect a user started with `--term-old`/`--term-new` in a
  terminal is read correctly instead of being invisible.
- `remaining`/`steps` come from `git rev-list --bisect-vars refs/bisect/<bad> --not
  refs/bisect/<good>-*` → `bisect_nr` / `bisect_steps`. This is git's own
  computation, so the numbers match what `git bisect good` prints — and unlike
  scraping that output it is recomputable after a restart, which is the whole
  point.
- `first_bad_oid` is set when `bisect_vars`' `bisect_rev` equals
  `refs/bisect/<bad>`, which is precisely the condition git's own `bisect_next`
  uses to print *"<sha> is the first bad commit"*. Note that HEAD stays on the last
  *tested* commit at that point, not on the culprit — so the bar has to name the
  culprit rather than let the user assume it is checked out.

Ops: `bisect_start(bad, good[])`, `bisect_mark(Good|Bad|Skip, rev?)`,
`bisect_reset()`. `git bisect start <bad> <good…>` accepts zero good revs (git then
waits for one), so the "mark this commit bad, I will find a good one later" entry
point is legal.

**No dedicated bar component.** `bisectStatus` joins `repoState` and `rebaseStatus`
in `useRepoStore` (same shape, same refresh), and `OperationBar` gains a `bisect`
`OpKind` with its own actions — **Good**, **Bad**, **Skip**, **Reset** — and detail
line: `"4 revisions left · ~2 steps"`, or `"first bad commit abc1234"` once it
converges. Crucially the generic **Abort** is *replaced* by **Reset** for this
state: `abort_operation` hard-resets to HEAD, which mid-bisect is a detached test
commit; `git bisect reset` returns to `BISECT_START`. The current bar offers
exactly the wrong button.

**Entry points.** History's commit context menu gains a Bisect group: while clean,
"Start bisect — this commit is bad/good"; while bisecting, "Mark as bad/good" and
"Skip" for the named commit. Two selected commits offer "Start bisect (newest bad,
oldest good)". The palette gets `Start bisect…` (pick bad → pick good), the three
marks, and Reset.

**No keymap chords for bisect.** Every action in the catalog must be bound in both
presets (`presets.test.ts`), and the number chords are full; more importantly a
bare-chord misfire during a bisect silently corrupts the search and there is no
undo short of `bisect reset`. Marking goes through the bar, the menu or the
palette — all of which name the commit they act on. The two new **screens** do get
chords: `nav.submodules` on `Mod+Shift+6` and `nav.worktrees` on `Mod+Shift+7`,
both presets (digits resolve from `e.code`, so they are layout-independent, and
neither collides). Submodules was specified as `Mod+Shift+8`; #92 landed first
and took that chord for `nav.pulls`, so this moved rather than displacing a
shipped binding.

## Errors

Two new `AppError` variants, mirrored in `src/lib/errors.ts` the same commit:

- **`LfsUnavailable(String)`** — the `git-lfs` binary is missing or unrunnable. A
  state the UI disables on, distinct from `Git`/`Network` so it never reaches a
  banner as git's *"'lfs' is not a git command"*.
- **`NoBisect`** — an op that requires a bisect in progress and found none
  (`bisect_mark`, `bisect_reset`). Distinct from `Git` so the UI can just refresh
  instead of alarming: the usual cause is that another process finished the bisect.

Everything else reuses the existing enum: `DirtyWorktree` for `git worktree
remove`'s refusal, `InvalidArgument` for a bad worktree name or an already-existing
path, `InvalidRef` for an unresolvable bisect rev, `Io`/`Git` for the rest.

## Testing

- **Rust** (`cargo test`, real temp repos via `TempRepo`):
  - `submodules.rs` — list on a repo with a real submodule (added with
    `protocol.file.allow=always`, which git ≥2.38 needs for a file-path
    submodule); the four `SubmoduleState`s; init flips `Uninitialized`; sync
    rewrites `.git/config`; `FileStatus.submodule` is set on the gitlink row and
    `embedded` is not.
  - `worktrees.rs` — add (new branch and existing branch), list, lock/unlock with a
    reason, remove, remove refused on a dirty worktree, prune after deleting the
    directory behind git's back. All in sibling tempdirs.
  - `bisect.rs` — start/good/bad/skip/reset against a 10-commit fixture with a
    known culprit; the reported `remaining`/`steps` match git's; convergence sets
    `first_bad_oid`; **restart survival**: a *fresh* `Libgit2Backend` reads the
    in-progress bisect from git's files and can continue and reset it (the
    equivalent of `rebase_durability.rs`'s restart cases).
  - `lfs.rs` — pointer parsing and `.gitattributes` scanning as pure functions;
    `lfs_status` on a repo with `filter=lfs` attributes reports `in_use: true` with
    the patterns **and** `installed: false` when the binary is absent; the ops
    raise `LfsUnavailable` rather than a git error. Everything that needs a real
    `git-lfs` is conditional on the binary being present.
- **Frontend unit:** `SubmoduleState`→row presentation, `lfsPointerLabel`
  formatting, bisect progress copy.
- **Component (RTL + `mockInvoke`, `WithDialogs`):** `Submodules.test.tsx`,
  `Worktrees.test.tsx` (incl. the remove confirm and the dirty→force second gate),
  `LfsPanel.test.tsx` (disabled state with no binary), `OperationBar.bisect.test.tsx`.
- **E2E:** `worktrees.e2e.ts` (add → list → remove, asserted against `git worktree
  list` in the fixture), `submodules.e2e.ts` (list + init), `bisect.e2e.ts` (start
  from History, mark, converge, reset — asserted against `git bisect log` /
  `.git/BISECT_LOG` absence).

## Out of scope

- `git submodule add` / deinit / removal, and submodule-aware commit composition.
- `git lfs track/untrack`, `lfs prune`, `lfs migrate`, `lfs locks`.
- `git worktree move`, `repair`, and bare/detached worktree creation.
- Bisect `run` (scripted automation), `replay`, `visualize`, and custom
  `--term-old`/`--term-new` **creation** (an existing custom-term bisect is read
  correctly; the app always starts one with git's defaults).
- Reviving `CliBackend` as a second real backend.
