# Stash — partial stash, rename, and a comparison that is actually about the stash

**Issue:** [#133](https://github.com/jonassaa/platypusgit/issues/133)

## Problem

Stashing is all-or-nothing, named once and forever, and the one way to look
inside an entry answers the wrong question.

1. **Whole-worktree only.** `stash_save` takes
   `StashSaveOptions { message, include_untracked, keep_index }` and calls
   libgit2's `stash_save2` (`git/mod.rs`, `libgit2.rs`). There is no pathspec
   anywhere in the chain, and libgit2's stash API has no way to accept one.
2. **No rename.** `stashMenuItems` (`design/context-menu.tsx`) offers Apply /
   Pop / Branch from stash / Drop. `StashInfo` is `{ index, short_oid, message }`
   — it does not even carry the full oid a rename would need.
3. **The stash "Diff" compares against the wrong side.** The Branches screen's
   stash detail button raises a `stash-diff` intent, which `CommitDiff.tsx`
   fulfils as `diffCommits(stashShortOid, "HEAD")`. Two things are wrong with
   that, not one: the right side is *current* HEAD rather than the stash's own
   base, so the result mixes the stashed changes with everything that has landed
   since; and the direction is backwards — the stash is the FROM side, so the
   work the user stashed renders as deletions.

## Design

### A. `StashInfo` gains the two facts every piece here needs

```rust
pub struct StashInfo {
    pub index: usize,
    pub short_oid: String,
    pub oid: String,        // NEW — full oid
    pub message: String,
    pub untracked: bool,    // NEW — the entry has a third parent
}
```

`oid` is not a convenience. A stash entry is addressed two different ways and
they are not interchangeable:

- **`index` is a position in a reflog**, and every write to `refs/stash` shifts
  it. Rename *itself* shifts it (see §C), so an index captured before the
  operation is stale by the time the operation's second half runs.
- **`oid` names the commit**, and it survives anything that happens to the
  reflog around it.

So the ops split on which one is honest: `stash_diff` takes the **oid** (a
comparison is about a commit, and a stale index would silently diff a different
entry), while `stash_rename` and `stash_drop` take the **index** (a reflog entry
is what they edit) *and* re-verify the oid before they touch anything.

`untracked` is `parent_count() > 2`, an O(1) read. git's stash layout is: parent
0 = the commit the stash was taken on, parent 1 = the index state, parent 2 =
the untracked files, present only for `stash -u`. Nothing else in the app can
tell "this entry carries files git had no copy of" from "this entry doesn't",
and §B needs it to say so out loud.

### B. Comparing a stash — two targets, one screen, and the third parent named

Both comparisons stay in `CommitDiff`, the screen the existing (broken) action
already routes to. `Target` gains one case and fixes another:

| target | what it answers | fetch |
| --- | --- | --- |
| `stash-diff` | *what did this stash change* | `stash_diff(oid, …)` |
| `stash-vs-wt` | *would applying this fight what I have now* | `diff_ref_to_workdir(oid, …)` |

**Why not the `compare` screen (#131).** Its rev↔workdir half is exactly
`stash-vs-wt`, and reusing it would cost nothing. Its rev↔rev half is not
"stash against its parent", though: a stash commit's parents are three
*different* commits, so `parent^..stash` walks the index commit and the
untracked commit as if they were history, and the summary row would announce a
stash as "3 commits ahead". Splitting the pair across two screens to dodge that
would leave a user reading one stash under two vocabularies. Both stay here.
`CommitDiff`'s objection in the #131 spec — that `Target` is oid-shaped and a
working tree has no oid — does not apply: **the stash is the oid**, the working
tree is the far end, and the target is still immutable once routed.

**Direction: parent → stash**, so the stashed work reads as *additions*. The
current action has it backwards, which is half of why it reads wrong.

**The third parent is included in `stash-diff`, and excluded from
`stash-vs-wt`, and both say which.** This is the decision issue #133 demands be
made rather than defaulted into:

- `stash_diff` takes `include_untracked`. When the flag is on and the entry has
  a third parent, that parent's tree is diffed against the **empty** tree and
  the resulting all-added files are appended. That parent's tree contains
  nothing but the untracked payload, so the append is exact — no filtering, no
  double-counting with the tracked side. The UI passes `true`: `git stash show`
  defaults it off, but this app's own worktree diffs already show untracked
  content (`libgit2.rs::diff`'s `WorktreeTo*` kinds set
  `show_untracked_content`), and "the file I stashed is missing from the diff of
  the stash" is a silent failure of the exact kind #131 rejected for the same
  reason. The header carries `+ untracked` when `StashInfo.untracked` is set, so
  the semantics are read, not inferred.
- `stash-vs-wt` passes `include_untracked: false`, and the screen says
  `untracked files excluded on both sides`. Both halves of that are forced:
  a stash's untracked payload lives in the third parent, **not in the tree**
  `diff_ref_to_workdir` resolves, so it cannot participate however the flag is
  set; and turning the flag on would then fill the view with *worktree*
  untracked files, which are noise about the working tree, not about the stash.
  Excluding both sides is the only reading where the two ends mean the same
  thing.

`stash_diff` returns a bare `Vec<FileDiff>`, like `diff_commits` and unlike
`diff_ref_to_workdir`'s `WorkdirDiff`. The ceiling on that one exists because it
walks the live working tree, where an unignored `node_modules` is somebody
else's accident; a stash's untracked side is a set of files the user explicitly
asked git to store, already in the object database, already bounded by whatever
they stashed.

`sideLabel` (`features/compare/compareSides.ts`) learns to abbreviate a rev that
is a bare 40-hex oid to seven characters. Not a stash change as such — it is the
display-site `shortSha` rule CLAUDE.md already states — but a stash routed into
compare is the first thing that puts a full oid in that chip.

### C. Rename — store a fresh commit, verify, then drop

git has no rename op. A stash's displayed message is the **reflog message** of
its entry in `refs/stash`, and the only supported writer of that reflog is
`git stash store`. So a rename is store-then-drop, and the order matters: store
first means a failure anywhere leaves the original entry untouched.

Three findings from driving real git (2.50.1) decided the shape:

1. **`git stash store <oid>` is a silent no-op when `refs/stash` already points
   at `<oid>`.** It exits 0 and writes no reflog entry, because the underlying
   ref update is value-identical and git elides it. That is precisely
   `stash@{0}` — the entry a user is most likely to rename. A naive
   store-then-drop would therefore **destroy the top stash**: nothing stored,
   then the original dropped.
2. **So the rename stores a NEW commit, not the old one.** libgit2 writes a
   dangling commit (`repo.commit(None, …)`) with the original's tree, the
   original's parents *and* its original author/committer signatures — the
   message is the only thing that changes, so the entry keeps its own time.
   A different message means a different oid, which means `refs/stash` cannot
   already point at it, which means `store` cannot no-op. It also fixes a
   second-order wrongness: `git stash push` writes the same string as the
   commit message and the reflog message, and a `store`-only rename would leave
   the commit's own message stale forever.
3. **`git stash store` accepts `--`**, so the oid lands after the end-of-options
   separator per convention, and `-m <message>` is safe from option injection
   because parse-options consumes the following argv as the value whatever it
   starts with (verified with a `--`-prefixed message).

Full sequence, with the guard rails that make each step recoverable:

1. Read the list. Entry at `index` gives `(oid, message)`. `message == new` →
   return, having touched nothing.
2. Reject a `\n`/`\r` in the new message (`InvalidArgument`). A reflog is
   line-based; git itself squashes the newline to a space, which would leave the
   commit message and the reflog message disagreeing about what the stash is
   called.
3. Write the new commit. If it somehow hashes to the original oid, stop with an
   error — do not proceed to a `store` that would no-op.
4. `git stash store -m <new> -- <new_oid>`.
5. **Verify before dropping anything**: the list is one longer, `[0]` is the new
   oid with the new message, and `[index + 1]` is still the original oid with
   the original message. Any mismatch → error, **nothing dropped**. The worst
   outcome of a half-failure is a duplicate entry, which the user can drop; the
   worst outcome of skipping this check is a stash that no longer exists.
6. `stash_drop(index + 1)`.

The frontend must **re-read the list** rather than patch it: every index above
the renamed one is unchanged only because store-then-drop is net zero, and
relying on that arithmetic in two places is how the two get to disagree.
`useRepoStore.stashRename` calls `refreshAll()` like its neighbours.

### D. Partial stash — path level ships, hunk level is deferred on purpose

**Path level.** libgit2's stash API takes no pathspec, so this shells out:

```
git -C <workdir> stash push [--include-untracked] [--keep-index] [-m <msg>] -- <paths…>
```

- **Local, so it is not on the credentialed runner.** No remote is contacted; it
  joins `libgit2.rs::run_git_capture`'s prompt-less siblings, not
  `commands::net::run_git_authenticated`.
- **`--` before the paths**, per the end-of-options convention — a file named
  `-f` is otherwise an option.
- **`GIT_LITERAL_PATHSPECS=1`**, which the other shell-outs do not need because
  they pass no pathspecs. A path is data from `git status`, but git reads a
  leading `:` as pathspec magic, so `:(exclude)…` as a literal filename would
  otherwise select a different set of files than the row the user right-clicked.
  This is the pathspec-shaped member of the same family as the `--` rule.
- **`--include-untracked` is derived, not asked.** `git stash push -- <untracked
  path>` *fails* ("did not match any file(s) known to git") without it, so the
  flag is set exactly when the selection contains an untracked path —
  a bucket `splitFileSelection` already produces.
- **"Nothing was stashed" is a success, not an error.** A pathspec that matches
  only unchanged files makes git print `No local changes to save` and exit 0.
  So the op reads `refs/stash` before and after and returns
  `Option<String>` — `None` for the no-op — matching `stash_save`'s contract
  exactly rather than inventing a second one.

Entry point: the Files/Commit selection menu (`multiFileMenuItems`), beside
Stage / Unstage / Discard, which already read the same
`splitFileSelection` buckets. Embedded repos are excluded from the paths for
the same reason they cannot be staged.

**Hunk level is deferred, and this is the reasoning, not a shrug.** The issue's
proposed composition is: stage the selection, `git stash push --staged`, restore
the previous index. That restore is the problem.

- The index is not a tree. Restoring it from a saved tree loses intent-to-add
  entries, unmerged stages, and `assume-unchanged`/`skip-worktree` bits — state
  the user cannot see and would not know to reconstruct.
- The window between "we rewrote the index" and "we put it back" contains a
  real `git` subprocess. A crash, a SIGKILL, or a panic inside it leaves the
  user's index silently reduced to whatever we staged. **Staged-but-uncommitted
  work is the one category of content in a repository with no other copy
  anywhere** — that is the same class of loss the whole feature is supposed to
  prevent.
- Crash-safety would mean a journal file we write before mutating and replay on
  startup. CLAUDE.md's rebase/bisect pair is explicit about when that is
  warranted: `rebase_state.rs` exists because the app *drives* a replay git
  cannot finish, and `bisect.rs` refuses a parallel file because git owns the
  state. Index-restore is the bisect case — git owns the index — so a journal is
  the wrong instrument, and without one the dance is not safe.
- `--staged` also needs git ≥ 2.35, so it needs a version probe and a graceful
  refusal on older git regardless.

The alternative — build the partial tree explicitly and hand-write the three
stash commits and the `refs/stash` reflog entry — is a reimplementation of
git's stash object layout, where a bug produces an entry that looks valid and
applies wrong. That is a spec of its own, not a subtask of this one.

So: **path-level partial stash ships; hunk-level does not**, and the hunk-level
entry point is not stubbed, disabled or hinted at in the UI — an affordance that
does nothing is worse than its absence.

## Backend surface

Standard path for each (trait → `Libgit2Backend` → `CliBackend` stub → thin
command → `invoke_handler!` → TS type + wrapper → store).

```rust
fn stash_save_paths(&self, repo_id: &RepoId, opts: StashSaveOptions,
                    paths: &[PathBuf]) -> AppResult<Option<String>>;
fn stash_rename(&self, repo_id: &RepoId, index: usize, message: &str) -> AppResult<()>;
fn stash_diff(&self, repo_id: &RepoId, oid: &str, context_lines: u32,
              ignore_whitespace: bool, include_untracked: bool) -> AppResult<Vec<FileDiff>>;
```

A new pure module `git/stash.rs` holds the two argv builders
(`stash_push_args`, `stash_store_args`) and their unit tests, so the `--`
placement and the flag derivation are asserted without a repository — the same
split `forge/checkout.rs` uses.

**No new `AppError` variants.** Every failure here is already covered:
`InvalidArgument` (newline in a message, an empty path list), `InvalidRef` (an
oid that is not a stash commit), `Git` (a verification that did not hold).

## Testing

- **Rust — `tests/stash_partial.rs`**: `stash_save_paths` stashes only the named
  path and leaves the other dirty; returns `None` and changes nothing when the
  pathspec matches no changes; carries an untracked path when the selection has
  one; rejects an empty path list. Plus argv-builder unit tests in
  `git/stash.rs` pinning `--` before the paths and the flag derivation.
- **Rust — `tests/stash_rename.rs`**: renames `stash@{0}` — **the case a naive
  store-then-drop destroys** — and asserts the entry count is unchanged, the new
  message shows, and the stash still applies to the same content; renames a
  middle entry and asserts the others keep their messages and order; a newline
  message is refused with the entry untouched; a rename to the identical message
  is a no-op; and **an injected failure between store and drop leaves the
  original entry present** (driven by pointing the verification at a mutated
  list — the assertion is that nothing is dropped when the check does not hold).
- **Rust — `tests/stash_diff.rs`**: a stash's diff is against its own first
  parent and not HEAD (a commit landed *after* the stash must not appear);
  direction is parent → stash, so stashed work is additions; `include_untracked`
  adds the third parent's files and leaves them out when false; a stash with no
  third parent is unaffected by the flag; a non-stash commit is `InvalidRef`.
- **Frontend logic** — `compareSides.test.ts` gains the full-oid abbreviation.
- **Frontend component** — `screens/CommitDiff.stash.test.tsx`: the `stash-diff`
  intent calls `stash_diff` (not `diff_commits`) with the full oid, renders the
  `+ untracked` note only when the entry carries one; the `stash-vs-wt` intent
  calls `diff_ref_to_workdir` with `includeUntracked: false` and renders the
  exclusion note. `design/context-menu.stash.test.tsx`: Rename prompts with the
  current message and calls the store; the selection menu's Stash entry passes
  the non-embedded paths and derives `includeUntracked` from the untracked
  bucket; Drop still confirms.
- **E2E** — `e2e/specs/stash.e2e.ts` gains a rename round trip through the
  Branches screen. Written, not executed here; CI runs the suite on the PR.

## Out of scope

Hunk-level partial stash (§D). Stashing a *range* of a file from the diff pane.
Reordering stash entries. Applying a stash to a different branch than it was
taken on (Branch from stash already covers the useful half). A stash list
screen — the Branches screen's section is where stashes live.
