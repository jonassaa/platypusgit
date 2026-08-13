# Issue #61 Tier 2, PR 2 — line-level staging and word diff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the diff from hunk granularity to line granularity (D7) and from line colouring to intra-line highlighting (D8).

**Architecture:** D7 generalizes the existing `patch_text_for_hunk` into a selection-aware patch synthesizer and applies it through the same `git_apply` path the hunk ops already use, so nothing new touches the index. D8 is a self-contained pure TS function plus a rendering change in `PGDiffChunk`, with no dependency added and no backend involvement.

**Tech Stack:** Rust + git2 0.20 + `git apply` subprocess; React 19 + TypeScript; vitest; `cargo test` over the `TempRepo` fixture.

**Spec:** `docs/superpowers/specs/2026-08-13-issue-61-tier2-design.md`

## Global Constraints

- **Toolchain PATH.** Prefix every `pnpm`/`cargo` command with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **Errors:** IPC-crossing fns return `AppResult<T>`; add `AppError` variants rather than stringifying; a new Rust variant updates `src/lib/errors.ts` the same commit. `AppError::InvalidArgument(String)` already exists (added in PR 1).
- **Frontend never calls `invoke()` directly** — only typed wrappers in `src/lib/tauri.ts`.
- **git2 work from a Tauri command goes through `tokio::task::spawn_blocking`.**
- **`CliBackend` gets a `NotImplemented` stub for every new trait method.**
- **Import UI primitives from `@/design`.** New shared primitive → file in `src/design/` + re-export from `index.ts`.
- **Never hardcode the accent hue**; use `oklch(from var(--token) l c h / <alpha>)`.
- **Diff/code geometry belongs to `--lh-code`**, not row density — do not introduce `var(--row-step)` into diff rows.
- **E2E only via `pnpm test:e2e:docker`**, only when done, only affected specs.
- **Commit style:** Conventional Commits, `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Two facts established by reading the code — do not re-derive

1. **The changed-line index contract.** The frontend's `hunk.lines` (built by
   `diff.print` in `libgit2.rs`) contains header lines (`'H'`/`'F'` →
   `DiffLineKind::HunkHeader`) and maps every unrecognized origin to
   `Context`, while the backend's `Patch::line_in_hunk` (used by
   `patch_text_for_hunk`) skips anything that is not `'+'`, `'-'` or `' '`.
   **The two index spaces do not match.** So the wire contract is *not* "index
   into `hunk.lines`". It is:

   > **`selected` holds indices among the CHANGED lines of the hunk — the
   > `'+'`/`'-'` lines only, counted in hunk order from 0.**

   Both sides can compute that identically: the frontend counts entries whose
   kind is `Addition`/`Deletion`; the backend counts `'+'`/`'-'` origins from
   `line_in_hunk`. Task 1 pins this with a test.

2. **`PGDiffChunk` renders `add`/`rem` rows inline.** `PGDiffLine` is used only
   for `hunk`/`info` chunks. And `chunkDiffLines` groups **by kind**, so a
   removed run and the added run after it are two *adjacent* chunks. Both D7's
   selection UI and D8's word spans therefore live in `PGDiffChunk`, and D8's
   pairing works across an adjacent `(rem, add)` chunk pair.

---

### Task 1: Selection-aware patch synthesis

**Files:**
- Modify: `src-tauri/src/git/libgit2.rs:495-554` (`patch_text_for_hunk`)
- Test: `src-tauri/tests/hunks.rs` (append)

**Interfaces:**
- Produces:
  ```rust
  enum PatchDirection { Apply, Reverse }

  fn patch_text_for_lines(
      diff: &git2::Diff,
      delta_index: usize,
      hunk_index: usize,
      selected: &[usize],          // indices among CHANGED lines, hunk order
      direction: PatchDirection,
  ) -> AppResult<String>;
  ```
  `patch_text_for_hunk(diff, d, h)` stays, implemented as
  `patch_text_for_lines(diff, d, h, &all_changed_indices, PatchDirection::Apply)`
  so the hunk ops keep one code path with the line ops.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/hunks.rs`. These assert the *synthesized patch text*, which is the one place the invariant is visible directly:

```rust
/// A file whose worktree adds three lines to a one-line base, so the hunk has
/// three '+' changed lines at indices 0,1,2.
fn three_additions() -> TempRepo {
    let tr = TempRepo::with_initial_commit("base\n");
    support::fs::write_file(tr.path(), "README.md", "base\nadd1\nadd2\nadd3\n");
    tr
}

#[test]
fn partial_patch_keeps_only_selected_additions() {
    let tr = three_additions();
    let (backend, handle) = tr.open_with_backend();

    // Stage only the middle addition.
    backend
        .stage_lines(&handle.id, Path::new("README.md"), 0, &[1], 3)
        .expect("stage_lines");

    // Index now has base + add2; worktree still has all three.
    let staged = String::from_utf8(
        tr.repo
            .find_blob(
                tr.repo
                    .index()
                    .unwrap()
                    .get_path(Path::new("README.md"), 0)
                    .unwrap()
                    .id,
            )
            .unwrap()
            .content()
            .to_vec(),
    )
    .unwrap();
    assert_eq!(staged, "base\nadd2\n", "only the selected line is staged");

    let worktree = std::fs::read_to_string(tr.path().join("README.md")).unwrap();
    assert_eq!(worktree, "base\nadd1\nadd2\nadd3\n", "worktree untouched");
}

#[test]
fn unselected_removal_becomes_context_and_survives() {
    // Base has three lines; the worktree deletes all three. Staging only the
    // first deletion must leave the other two lines in the index.
    let tr = TempRepo::with_initial_commit("one\ntwo\nthree\n");
    support::fs::write_file(tr.path(), "README.md", "");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, Path::new("README.md"), 0, &[0], 3)
        .expect("stage_lines");

    let staged = String::from_utf8(
        tr.repo
            .find_blob(
                tr.repo
                    .index()
                    .unwrap()
                    .get_path(Path::new("README.md"), 0)
                    .unwrap()
                    .id,
            )
            .unwrap()
            .content()
            .to_vec(),
    )
    .unwrap();
    assert_eq!(
        staged, "two\nthree\n",
        "unselected deletions must have become context, not been applied"
    );
}

#[test]
fn empty_selection_is_invalid_argument() {
    let tr = three_additions();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .stage_lines(&handle.id, Path::new("README.md"), 0, &[], 3)
        .expect_err("empty selection must be rejected");
    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidArgument(_)),
        "expected InvalidArgument, got {err:?}"
    );
}

#[test]
fn out_of_range_selection_is_invalid_argument() {
    let tr = three_additions();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .stage_lines(&handle.id, Path::new("README.md"), 0, &[99], 3)
        .expect_err("out-of-range index must be rejected");
    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidArgument(_)),
        "expected InvalidArgument, got {err:?}"
    );
}

#[test]
fn selecting_every_changed_line_matches_staging_the_hunk() {
    let tr = three_additions();
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, Path::new("README.md"), 0, &[0, 1, 2], 3)
        .expect("stage_lines");

    let staged = String::from_utf8(
        tr.repo
            .find_blob(
                tr.repo
                    .index()
                    .unwrap()
                    .get_path(Path::new("README.md"), 0)
                    .unwrap()
                    .id,
            )
            .unwrap()
            .content()
            .to_vec(),
    )
    .unwrap();
    assert_eq!(staged, "base\nadd1\nadd2\nadd3\n");
}
```

> Add `use std::path::Path;` and `mod support;` imports if `hunks.rs` lacks them — copy its existing header rather than guessing.

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test hunks 2>&1 | tail -20
```
Expected: compile error — `no method named stage_lines`.

- [ ] **Step 3: Write the synthesizer**

In `src-tauri/src/git/libgit2.rs`, replace `patch_text_for_hunk` with the generalized pair. Note the header counts are recomputed from the emitted body, never copied:

```rust
/// Which way the synthesized patch will be applied. It changes which
/// *unselected* lines become context: reversal flips the side each line lands
/// on, so the rule for `+` and `-` swaps.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PatchDirection {
    Apply,
    Reverse,
}

/// Synthesize a patch containing only the selected changed lines of one hunk.
///
/// `selected` holds indices among the CHANGED (`+`/`-`) lines of the hunk,
/// counted in hunk order from 0 — NOT indices into `DiffHunk::lines`, which
/// also carries header and context entries. See the plan's index-contract note.
///
/// The rule is the one `git add -p` uses when you hand-edit a hunk. For
/// `Apply`: a selected `-`/`+` is kept as-is, an **unselected `-` becomes
/// context** (we are not removing it, so it exists on both sides), and an
/// **unselected `+` is dropped** (it exists on neither side of this partial
/// patch). For `Reverse` those two swap.
fn patch_text_for_lines(
    diff: &git2::Diff,
    delta_index: usize,
    hunk_index: usize,
    selected: &[usize],
    direction: PatchDirection,
) -> AppResult<String> {
    let patch = git2::Patch::from_diff(diff, delta_index)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Internal("no patch for delta".into()))?;

    let num_hunks = patch.num_hunks();
    if hunk_index >= num_hunks {
        return Err(AppError::InvalidRef(format!(
            "hunk index {} out of range (file has {} hunks)",
            hunk_index, num_hunks
        )));
    }

    let delta = diff
        .get_delta(delta_index)
        .ok_or_else(|| AppError::Internal(format!("delta {} missing", delta_index)))?;
    let path_str = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .ok_or_else(|| AppError::Internal("delta has no path".into()))?
        .to_string_lossy()
        .to_string();

    let (hunk_header, _) = patch.hunk(hunk_index).map_err(AppError::from)?;
    let old_start = hunk_header.old_start();
    let new_start = hunk_header.new_start();

    if selected.is_empty() {
        return Err(AppError::InvalidArgument(
            "no lines selected".to_string(),
        ));
    }
    let chosen: std::collections::HashSet<usize> = selected.iter().copied().collect();

    // Emit the body, numbering changed lines exactly the way the caller does.
    let mut body = String::new();
    let mut old_count: u32 = 0;
    let mut new_count: u32 = 0;
    let mut changed_seen: usize = 0;

    let line_count = patch.num_lines_in_hunk(hunk_index).map_err(AppError::from)?;
    for line_i in 0..line_count {
        let line = patch.line_in_hunk(hunk_index, line_i).map_err(AppError::from)?;
        let origin = line.origin();
        if !matches!(origin, '+' | '-' | ' ') {
            continue;
        }
        let content = std::str::from_utf8(line.content())
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // ' ' is context on both sides, regardless of direction or selection.
        let emit = if origin == ' ' {
            Some(' ')
        } else {
            let idx = changed_seen;
            changed_seen += 1;
            let is_selected = chosen.contains(&idx);
            if is_selected {
                Some(origin)
            } else {
                // The unselected side that must survive becomes context; the
                // other is dropped entirely.
                let context_side = match direction {
                    PatchDirection::Apply => '-',
                    PatchDirection::Reverse => '+',
                };
                if origin == context_side {
                    Some(' ')
                } else {
                    None
                }
            }
        };

        let Some(marker) = emit else { continue };
        match marker {
            ' ' => {
                old_count += 1;
                new_count += 1;
            }
            '-' => old_count += 1,
            '+' => new_count += 1,
            _ => {}
        }
        body.push(marker);
        body.push_str(content);
        if !content.ends_with('\n') {
            body.push('\n');
        }
    }

    if changed_seen == 0 {
        return Err(AppError::InvalidArgument(
            "hunk has no changed lines".to_string(),
        ));
    }
    if let Some(&max) = chosen.iter().max() {
        if max >= changed_seen {
            return Err(AppError::InvalidArgument(format!(
                "line index {} out of range (hunk has {} changed lines)",
                max, changed_seen
            )));
        }
    }

    let mut out = String::new();
    out.push_str(&format!("diff --git a/{p} b/{p}\n", p = path_str));
    out.push_str(&format!("--- a/{}\n", path_str));
    out.push_str(&format!("+++ b/{}\n", path_str));
    // Counts are recomputed from the emitted body — copying the source hunk's
    // header is the classic way to produce a patch `git apply` rejects.
    out.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        old_start, old_count, new_start, new_count
    ));
    out.push_str(&body);
    Ok(out)
}

/// Whole-hunk patch — every changed line selected.
fn patch_text_for_hunk(diff: &git2::Diff, delta_index: usize, hunk_index: usize) -> AppResult<String> {
    let all: Vec<usize> = (0..changed_line_count(diff, delta_index, hunk_index)?).collect();
    patch_text_for_lines(diff, delta_index, hunk_index, &all, PatchDirection::Apply)
}

/// How many `+`/`-` lines a hunk has — the size of the selection index space.
fn changed_line_count(
    diff: &git2::Diff,
    delta_index: usize,
    hunk_index: usize,
) -> AppResult<usize> {
    let patch = git2::Patch::from_diff(diff, delta_index)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Internal("no patch for delta".into()))?;
    let line_count = patch.num_lines_in_hunk(hunk_index).map_err(AppError::from)?;
    let mut n = 0;
    for i in 0..line_count {
        let line = patch.line_in_hunk(hunk_index, i).map_err(AppError::from)?;
        if matches!(line.origin(), '+' | '-') {
            n += 1;
        }
    }
    Ok(n)
}
```

- [ ] **Step 4: Commit the synthesizer alone**

It has no callers yet beyond `patch_text_for_hunk`, so the existing hunk tests are its regression net.

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test hunks 2>&1 | tail -20
```
Expected: still the `stage_lines` compile error, but no *other* failures once
Task 2 lands. If you want a green checkpoint first, comment out the new tests,
confirm the existing hunk tests pass, then restore them.

```bash
git add src-tauri/src/git/libgit2.rs
git commit -m "refactor(diff): selection-aware patch synthesis (#61 D7)

Generalizes patch_text_for_hunk into patch_text_for_lines. Unselected '-'
becomes context, unselected '+' is dropped, and the two swap for reverse
application; @@ counts are recomputed from the emitted body rather than
copied from the source hunk.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The three line ops

**Files:**
- Modify: `src-tauri/src/git/mod.rs` (trait, beside `stage_hunk`/`unstage_hunk`/`discard_hunk` at `:171-186`)
- Modify: `src-tauri/src/git/libgit2.rs` (impls beside the hunk trio at `:1979-2071`)
- Modify: `src-tauri/src/git/cli.rs` (stubs)
- Modify: `src-tauri/src/commands/diff.rs` (commands)
- Modify: `src-tauri/src/lib.rs` (registry)
- Test: `src-tauri/tests/hunks.rs` (the tests from Task 1)

**Interfaces:**
- Consumes: `patch_text_for_lines`, `changed_line_count`, `PatchDirection` from Task 1.
- Produces, on `GitBackend` and as Tauri commands `stage_lines` / `unstage_lines` / `discard_lines`:
  ```rust
  fn stage_lines(&self, repo_id: &RepoId, path: &Path, hunk_index: usize,
                 selected: &[usize], context_lines: u32) -> AppResult<()>;
  fn unstage_lines(&self, repo_id: &RepoId, path: &Path, hunk_index: usize,
                   selected: &[usize], context_lines: u32) -> AppResult<()>;
  fn discard_lines(&self, repo_id: &RepoId, path: &Path, hunk_index: usize,
                   selected: &[usize], context_lines: u32) -> AppResult<()>;
  ```
  None take `ignore_whitespace` — same reason the hunk ops don't (`git/mod.rs:94-97`).

- [ ] **Step 1: Add the trait methods**

In `src-tauri/src/git/mod.rs`, after `discard_hunk`:

```rust
    /// Stage only the selected changed lines of one hunk.
    ///
    /// `selected` holds indices among the hunk's CHANGED (`+`/`-`) lines,
    /// counted in hunk order from 0 — not indices into `DiffHunk::lines`,
    /// which also carries header and context entries.
    ///
    /// Like the hunk ops these take no `ignore_whitespace`: that flag rewrites
    /// hunk boundaries, so indices derived from a whitespace-ignoring diff do
    /// not address what git would apply.
    fn stage_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()>;
    /// Unstage only the selected changed lines of one hunk (see `stage_lines`).
    fn unstage_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()>;
    /// Discard only the selected changed lines of one hunk (see `stage_lines`).
    fn discard_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()>;
```

- [ ] **Step 2: Implement them**

In `src-tauri/src/git/libgit2.rs`, after `discard_hunk`. Each mirrors its hunk sibling, swapping the whole-hunk patch for a partial one. `stage_lines` uses `git_apply --cached` rather than libgit2's `hunk_callback`, because a callback can select a whole hunk but not a subset of its lines:

```rust
    fn stage_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()> {
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.context_lines(context_lines);
            let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_lines(
                &diff,
                delta_index,
                hunk_index,
                selected,
                PatchDirection::Apply,
            )
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--cached"], &patch_text)
    }

    fn unstage_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()> {
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.context_lines(context_lines);
            let head_tree = match repo.head() {
                Ok(h) => Some(h.peel_to_tree()?),
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                Err(e) => return Err(e.into()),
            };
            let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_lines(
                &diff,
                delta_index,
                hunk_index,
                selected,
                PatchDirection::Reverse,
            )
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--cached", "--reverse"], &patch_text)
    }

    fn discard_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()> {
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.context_lines(context_lines);
            let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_lines(
                &diff,
                delta_index,
                hunk_index,
                selected,
                PatchDirection::Reverse,
            )
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--reverse"], &patch_text)
    }
```

- [ ] **Step 3: Add the `CliBackend` stubs**

In `src-tauri/src/git/cli.rs`, beside the hunk stubs — three methods with the same signatures, each `Err(AppError::NotImplemented)`, parameters underscore-prefixed.

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test hunks 2>&1 | tail -25
```
Expected: the five new tests pass and every pre-existing hunk test still passes.

If `partial_patch_keeps_only_selected_additions` fails with a `git apply` rejection, the `@@` counts and the body disagree — print `patch_text` and check `old_count`/`new_count` against the emitted markers before changing anything else.

- [ ] **Step 5: Add the commands and register them**

In `src-tauri/src/commands/diff.rs`, three thin commands mirroring the existing `stage_hunk`/`unstage_hunk`/`discard_hunk` handlers, each taking `selected: Vec<usize>` and passing `&selected`. Register all three in `invoke_handler![…]` in `src-tauri/src/lib.rs` beside the hunk ops.

- [ ] **Step 6: Verify and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "test result: FAILED|error\[" | head
```
Expected: no output.

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs src-tauri/src/commands/diff.rs src-tauri/src/lib.rs src-tauri/tests/hunks.rs
git commit -m "feat(diff): stage/unstage/discard selected lines (#61 D7)

Why: stage_lines applies a synthesized partial patch via git_apply --cached
rather than libgit2's hunk_callback, which can select a whole hunk but not a
subset of its lines. Tests assert resulting index and worktree contents, not
patch text.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wrappers and store actions for the line ops

**Files:**
- Modify: `src/lib/tauri.ts` (beside `stageHunk`/`unstageHunk`/`discardHunk`)
- Modify: `src/features/repo/useRepoStore.ts` (imports, interface, actions beside the hunk actions)

**Interfaces:**
- Produces:
  ```typescript
  stageLines(repoId: string, path: string, hunkIndex: number, selected: number[]): Promise<void>
  unstageLines(...same): Promise<void>
  discardLines(...same): Promise<void>
  ```
  and on the store: `stageLines(path, hunkIndex, selected)`, `unstageLines(...)`, `discardLines(...)`.

- [ ] **Step 1: Add the three wrappers**

In `src/lib/tauri.ts`, matching the existing hunk wrappers' shape exactly (copy their `contextLines` handling — if `stageHunk` sends a context-lines argument, these send it the same way):

```typescript
/**
 * Stage only the selected changed lines of one hunk. `selected` holds indices
 * among the hunk's `+`/`-` lines counted from 0 — not indices into
 * `hunk.lines`, which also contains context rows.
 */
export async function stageLines(
  repoId: string,
  path: string,
  hunkIndex: number,
  selected: number[],
): Promise<void> {
  return invoke<void>("stage_lines", { repoId, path, hunkIndex, selected });
}
```

plus `unstageLines` and `discardLines` with the same shape and `"unstage_lines"` / `"discard_lines"`.

- [ ] **Step 2: Add the three store actions**

In `src/features/repo/useRepoStore.ts`, mirroring the existing `stageHunk` action body exactly (same refresh and error handling):

```typescript
  async stageLines(path, hunkIndex, selected) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stageLinesFn(repo.id, path, hunkIndex, selected);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },
```

and the same for `unstageLines` / `discardLines`. Add each to the store interface.

- [ ] **Step 3: Verify and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit && pnpm test --run 2>&1 | tail -5
```
Expected: clean type-check, all tests pass.

```bash
git add src/lib/tauri.ts src/features/repo/useRepoStore.ts
git commit -m "feat(diff): wire line staging through wrappers and store (#61 D7)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Word diff — the pure function

**Files:**
- Create: `src/lib/wordDiff.ts`
- Test: `src/lib/wordDiff.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface WordSpan { start: number; end: number; changed: boolean }
  export interface WordDiffResult { old: WordSpan[]; new: WordSpan[] }
  /** null when the pair is not worth highlighting (guards or low similarity). */
  export function wordDiff(oldText: string, newText: string): WordDiffResult | null
  export const MAX_LINE_CHARS = 1000
  export const MAX_TOKENS = 200
  export const MIN_SIMILARITY = 0.3
  ```
  Spans tile each input completely and in order — every character index is
  covered exactly once — so a renderer can emit them without gap handling.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/wordDiff.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  MAX_LINE_CHARS,
  wordDiff,
  type WordDiffResult,
} from "./wordDiff";

/** The changed substrings of one side, for compact assertions. */
const changed = (text: string, spans: WordDiffResult["old"]) =>
  spans.filter((s) => s.changed).map((s) => text.slice(s.start, s.end));

/** Spans must tile the whole input, in order, with no gaps or overlaps. */
function assertTiles(text: string, spans: WordDiffResult["old"]) {
  let at = 0;
  for (const s of spans) {
    expect(s.start).toBe(at);
    expect(s.end).toBeGreaterThan(s.start);
    at = s.end;
  }
  expect(at).toBe(text.length);
}

describe("wordDiff", () => {
  it("returns no changed spans for identical text", () => {
    const r = wordDiff("const a = 1;", "const a = 1;")!;
    expect(changed("const a = 1;", r.old)).toEqual([]);
    expect(changed("const a = 1;", r.new)).toEqual([]);
  });

  it("isolates a single changed word", () => {
    const a = "const a = 1;";
    const b = "const a = 2;";
    const r = wordDiff(a, b)!;
    expect(changed(a, r.old)).toEqual(["1"]);
    expect(changed(b, r.new)).toEqual(["2"]);
  });

  it("handles an insertion at the end", () => {
    const a = "call(x)";
    const b = "call(x, y)";
    const r = wordDiff(a, b)!;
    expect(changed(a, r.old)).toEqual([]);
    expect(changed(b, r.new).join("")).toContain("y");
  });

  it("handles an insertion at the start", () => {
    const a = "value";
    const b = "new value";
    const r = wordDiff(a, b)!;
    expect(changed(b, r.new).join("")).toContain("new");
  });

  it("tiles both sides completely", () => {
    const a = "let total = price * qty;";
    const b = "let total = price * quantity;";
    const r = wordDiff(a, b)!;
    assertTiles(a, r.old);
    assertTiles(b, r.new);
  });

  it("treats a whitespace-only difference as changed whitespace, not words", () => {
    const a = "a  b";
    const b = "a b";
    const r = wordDiff(a, b)!;
    expect(changed(a, r.old).join("").trim()).toBe("");
    expect(changed(b, r.new).join("").trim()).toBe("");
  });

  it("returns null for a pair below the similarity threshold", () => {
    expect(wordDiff("alpha beta gamma", "totally different words here")).toBeNull();
  });

  it("returns null when a line is too long to diff", () => {
    const long = "x".repeat(MAX_LINE_CHARS + 1);
    expect(wordDiff(long, long + "y")).toBeNull();
  });

  it("maps multi-byte characters to correct ranges", () => {
    const a = "greet('héllo')";
    const b = "greet('wörld')";
    const r = wordDiff(a, b)!;
    expect(changed(a, r.old)).toEqual(["héllo"]);
    expect(changed(b, r.new)).toEqual(["wörld"]);
  });

  it("is symmetric in span coverage for a swap", () => {
    const r1 = wordDiff("a = b", "a = c")!;
    const r2 = wordDiff("a = c", "a = b")!;
    expect(changed("a = b", r1.old)).toEqual(changed("a = b", r2.new));
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/lib/wordDiff.test.ts --run 2>&1 | tail -10
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement it**

Create `src/lib/wordDiff.ts`. Hand-rolled to match `graphLayout` / `semver.ts` — tested pure functions with no dependency:

```typescript
/**
 * Intra-line (word) diff for a removed/added line pair (#61 D8).
 *
 * Hand-rolled rather than pulled from a text-diff library: this needs exactly
 * one mode, and the repo's convention for this kind of logic is a tested pure
 * function (see graphLayout, buildRebasePlan, semver).
 */

/** Longest line this will diff. Beyond it, callers fall back to line colour. */
export const MAX_LINE_CHARS = 1000;
/** Largest token count per side — the LCS table is O(n·m). */
export const MAX_TOKENS = 200;
/** Minimum share of the shorter side's word tokens that must be common. */
export const MIN_SIMILARITY = 0.3;

export interface WordSpan {
  start: number;
  end: number;
  changed: boolean;
}

export interface WordDiffResult {
  old: WordSpan[];
  new: WordSpan[];
}

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Split into word runs, whitespace runs, and single punctuation chars. */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index;
    out.push({ text: m[0], start, end: start + m[0].length });
  }
  return out;
}

/** Classic LCS table over token text. Returns matched index pairs. */
function lcsPairs(a: Token[], b: Token[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i].text === b[j].text
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Turn matched token indices into tiling spans: every character of `text` is
 * covered exactly once, in order, so a renderer needs no gap handling.
 */
function toSpans(text: string, tokens: Token[], matched: Set<number>): WordSpan[] {
  const out: WordSpan[] = [];
  let at = 0;
  const push = (start: number, end: number, changed: boolean) => {
    if (end <= start) return;
    const last = out[out.length - 1];
    if (last && last.changed === changed && last.end === start) {
      last.end = end;
      return;
    }
    out.push({ start, end, changed });
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Any characters the tokenizer skipped stay unchanged filler.
    push(at, t.start, false);
    push(t.start, t.end, !matched.has(i));
    at = t.end;
  }
  push(at, text.length, false);
  return out;
}

/** True when the tokens carry a word or number (whitespace/punctuation do not). */
function isWordy(t: Token): boolean {
  return /[\p{L}\p{N}_]/u.test(t.text);
}

/**
 * Intra-line diff of a removed/added line pair.
 *
 * Returns `null` when the pair should render as a plain whole-line
 * add/remove: either a cost guard tripped, or the two lines are too dissimilar
 * to be "the same line edited" — highlighting unrelated rewrites at random
 * reads as noise and is worse than no word diff at all.
 */
export function wordDiff(oldText: string, newText: string): WordDiffResult | null {
  if (oldText.length > MAX_LINE_CHARS || newText.length > MAX_LINE_CHARS) {
    return null;
  }
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;
  if (a.length === 0 && b.length === 0) {
    return { old: [], new: [] };
  }

  const pairs = lcsPairs(a, b);

  // Similarity is measured over WORD tokens only: two lines sharing nothing
  // but spaces and brackets are not "the same line edited".
  const wordsA = a.filter(isWordy).length;
  const wordsB = b.filter(isWordy).length;
  const shorter = Math.min(wordsA, wordsB);
  if (shorter > 0) {
    const commonWords = pairs.filter(([i]) => isWordy(a[i])).length;
    if (commonWords / shorter < MIN_SIMILARITY) return null;
  }

  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  return {
    old: toSpans(oldText, a, matchedA),
    new: toSpans(newText, b, matchedB),
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/lib/wordDiff.test.ts --run 2>&1 | tail -12
```
Expected: all pass. If the whitespace-only case fails, check that whitespace runs are single tokens rather than per-character.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wordDiff.ts src/lib/wordDiff.test.ts
git commit -m "feat(diff): word-level intra-line diff helper (#61 D8)

Hand-rolled token LCS, no dependency added — matches how graphLayout and
semver are done here. Returns null rather than a result when a cost guard
trips or the pair is too dissimilar to be the same line edited, so unrelated
rewrites are not highlighted at random. Spans tile each side completely so
the renderer needs no gap handling.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Render word spans in the diff

**Files:**
- Modify: `src/design/git-components.tsx` (`chunkDiffLines` `:621`, `PGDiffChunk` `:634-748`)
- Test: `src/design/wordDiffRender.test.tsx`

**Interfaces:**
- Consumes: `wordDiff` from Task 4.
- Produces: nothing new exported. `PGHunk`'s public props are unchanged — pairing is derived inside, so no caller changes.

- [ ] **Step 1: Write the failing test**

Create `src/design/wordDiffRender.test.tsx`:

```tsx
// Intra-line highlighting inside the unified diff (#61 D8).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGHunk } from "./git-components";

const pair = [
  { kind: "rem" as const, lnL: 1, text: "const a = 1;" },
  { kind: "add" as const, lnR: 1, text: "const a = 2;" },
];

describe("word diff rendering", () => {
  it("marks only the changed token in each side", () => {
    render(<PGHunk header="-1,1 +1,1" lines={pair} />);
    const marks = screen.getAllByTestId("word-change");
    expect(marks.map((m) => m.textContent)).toEqual(["1", "2"]);
  });

  it("adds no marks to a context-only hunk", () => {
    render(
      <PGHunk
        header="-1,1 +1,1"
        lines={[{ kind: "ctx", lnL: 1, lnR: 1, text: "unchanged" }]}
      />,
    );
    expect(screen.queryAllByTestId("word-change")).toHaveLength(0);
  });

  it("adds no marks when the two lines are unrelated", () => {
    render(
      <PGHunk
        header="-1,1 +1,1"
        lines={[
          { kind: "rem", lnL: 1, text: "alpha beta gamma" },
          { kind: "add", lnR: 1, text: "totally different words here" },
        ]}
      />,
    );
    expect(screen.queryAllByTestId("word-change")).toHaveLength(0);
  });

  it("still renders the full line text when highlighting", () => {
    render(<PGHunk header="-1,1 +1,1" lines={pair} />);
    expect(screen.getByText(/const a = 1;/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/wordDiffRender.test.tsx --run 2>&1 | tail -10
```
Expected: FAIL — no `word-change` elements.

- [ ] **Step 3: Pair adjacent rem/add chunks and render spans**

In `src/design/git-components.tsx`:

First, give each `add`/`rem` chunk its word spans. `chunkDiffLines` groups **by kind**, so a removed run and the added run after it are two adjacent chunks — pairing is across that pair, not inside one chunk. Add after `chunkDiffLines`:

```tsx
/**
 * Attach intra-line word spans to adjacent rem/add chunk pairs (#61 D8).
 *
 * chunkDiffLines groups by kind, so a removed run and the added run that
 * follows it are two ADJACENT chunks. The i-th removed line pairs with the
 * i-th added line for the first min(rem, add) lines; wordDiff itself returns
 * null for pairs too dissimilar to be the same line edited, and those simply
 * get no spans.
 */
function withWordSpans(chunks: DiffChunk[]): DiffChunk[] {
  const out = chunks.map((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l })) }));
  for (let i = 0; i + 1 < out.length; i++) {
    const rem = out[i];
    const add = out[i + 1];
    if (rem.kind !== "rem" || add.kind !== "add") continue;
    const n = Math.min(rem.lines.length, add.lines.length);
    for (let k = 0; k < n; k++) {
      const r = wordDiff(rem.lines[k].text ?? "", add.lines[k].text ?? "");
      if (!r) continue;
      rem.lines[k].spans = r.old;
      add.lines[k].spans = r.new;
    }
  }
  return out;
}
```

Add the optional field to `DiffLineData`:

```tsx
  /**
   * Intra-line word spans, when this line is half of a matched rem/add pair.
   * Set by the renderer, not by callers.
   */
  spans?: WordSpan[];
```

Add a span renderer beside `PGDiffChunk`:

```tsx
/** Render line text, tinting the changed spans when a word diff produced any. */
function DiffText({
  text,
  spans,
  kind,
}: {
  text: string;
  spans?: WordSpan[];
  kind: DiffLineKind;
}) {
  if (!spans || spans.length === 0) return <>{text}</>;
  const tint =
    kind === "add"
      ? "oklch(from var(--git-added) l c h / 0.28)"
      : "oklch(from var(--git-removed) l c h / 0.28)";
  return (
    <>
      {spans.map((s, i) =>
        s.changed ? (
          <span
            key={i}
            data-testid="word-change"
            style={{ background: tint, borderRadius: 2 }}
          >
            {text.slice(s.start, s.end)}
          </span>
        ) : (
          <React.Fragment key={i}>{text.slice(s.start, s.end)}</React.Fragment>
        ),
      )}
    </>
  );
}
```

Then in `PGHunk`, run the chunks through the pairing pass:

```tsx
          {withWordSpans(chunkDiffLines(lines)).map((c, i) => (
            <PGDiffChunk key={i} chunk={c} />
          ))}
```

And in `PGDiffChunk`'s inline row markup (the `add`/`rem` path), replace the bare `{ln.text}` in the final `<span>` with:

```tsx
            <DiffText text={ln.text ?? ""} spans={ln.spans} kind={kind} />
```

Import `wordDiff` and `WordSpan` from `@/lib/wordDiff` at the top of the file.

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/wordDiffRender.test.tsx --run 2>&1 | tail -12
```
Expected: all four pass.

- [ ] **Step 5: Memoize the pairing pass**

`withWordSpans` runs per render of every hunk, and these lists are long and
windowed. Wrap it in the hunk body:

```tsx
  const chunks = React.useMemo(
    () => withWordSpans(chunkDiffLines(lines)),
    [lines],
  );
```

and map over `chunks`. Re-run the test file to confirm it still passes.

- [ ] **Step 6: Commit**

```bash
git add src/design/git-components.tsx src/design/wordDiffRender.test.tsx
git commit -m "feat(diff): highlight intra-line changes in the unified diff (#61 D8)

Why: chunkDiffLines groups by kind, so a removed run and the added run after
it are two ADJACENT chunks — pairing happens across that pair, not inside a
chunk. Tints derive from --git-added/--git-removed via relative colour so
custom and light themes carry through. Memoized: these lists are windowed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Line selection UI in the diff surfaces

**Files:**
- Modify: `src/design/git-components.tsx` (`PGHunkProps`, `PGHunk`, `PGDiffChunk` row click targets)
- Modify: `src/screens/CommitPanel.tsx:810-841` (hunk render block — the selection owner)
- Test: `src/screens/CommitPanel.lineStaging.test.tsx`

**Interfaces:**
- Consumes: store actions from Task 3; `useHunkActionsDisabledReason` from `@/features/diff/WhitespaceToggle`.
- Produces: new optional `PGHunk` props —
  ```typescript
  /** Indices among this hunk's changed lines that are selected. */
  selectedLines?: number[];
  /** Called with a changed-line index; `range` is true for a shift-click. */
  onLineClick?: (changedIndex: number, range: boolean) => void;
  ```
  Selection **state** stays in the screen, not the primitive — the same rule
  that keeps tree keyboard handling in the screen rather than in `PGFileTree`,
  because a primitive owning selection plus the global dispatcher both answer
  the same input and the selection moves twice.

- [ ] **Step 1: Write the failing test**

Create `src/screens/CommitPanel.lineStaging.test.tsx`. Model it on the setup in `CommitPanel.whitespace.test.tsx` (same screen, same mocks) rather than inventing one:

```tsx
// Line-level staging from the CommitPanel diff (#61 D7).

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 3,
  deletions: 0,
  embedded: false,
});

// One hunk, three added lines → changed-line indices 0,1,2.
const diff = {
  path: "a.ts",
  oldPath: null,
  binary: false,
  additions: 3,
  deletions: 0,
  hunks: [
    {
      header: "@@ -1,1 +1,4 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 4,
      lines: [
        { kind: "Context", oldLineno: 1, newLineno: 1, content: "base\n" },
        { kind: "Addition", oldLineno: null, newLineno: 2, content: "add1\n" },
        { kind: "Addition", oldLineno: null, newLineno: 3, content: "add2\n" },
        { kind: "Addition", oldLineno: null, newLineno: 4, content: "add3\n" },
      ],
    },
  ],
};

function setup() {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [unstaged("a.ts")],
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_diff", () => diff);
  mockInvoke("get_status", () => [unstaged("a.ts")]);
  mockInvoke("stage_lines", () => undefined);
  render(
    <WithDialogs>
      <CommitPanelScreen />
    </WithDialogs>,
  );
}

const stageLinesCall = () =>
  getInvokeCalls().find((c) => c.cmd === "stage_lines");

describe("line-level staging", () => {
  beforeEach(() => resetInvokeMock());

  it("stages only the clicked line", async () => {
    setup();
    fireEvent.click(await screen.findByText("a.ts"));

    const rows = await screen.findAllByTestId("diff-line-changed");
    fireEvent.click(rows[1]); // second added line → changed index 1

    fireEvent.click(screen.getByTestId("hunk-stage"));
    await waitFor(() =>
      expect(stageLinesCall()?.args).toMatchObject({
        path: "a.ts",
        hunkIndex: 0,
        selected: [1],
      }),
    );
  });

  it("shifts the button label to the selection count", async () => {
    setup();
    fireEvent.click(await screen.findByText("a.ts"));
    const rows = await screen.findAllByTestId("diff-line-changed");
    fireEvent.click(rows[0]);
    fireEvent.click(rows[2]);
    expect(screen.getByTestId("hunk-stage").textContent).toMatch(/2 lines/i);
  });

  it("falls back to whole-hunk staging with no selection", async () => {
    setup();
    fireEvent.click(await screen.findByText("a.ts"));
    fireEvent.click(screen.getByTestId("hunk-stage"));
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "stage_hunk")).toBe(true),
    );
    expect(stageLinesCall()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/CommitPanel.lineStaging.test.tsx --run 2>&1 | tail -12
```
Expected: FAIL — no `diff-line-changed` elements.

- [ ] **Step 3: Make changed rows clickable in `PGDiffChunk`**

Thread `selectedLines` / `onLineClick` through `PGHunkProps` → `PGHunk` →
`PGDiffChunk`. Each `add`/`rem` row needs its **changed-line index**, which
`withWordSpans`/`chunkDiffLines` must now carry: extend `DiffLineData` with

```tsx
  /** Index among the hunk's changed (+/-) lines, or undefined for context. */
  changedIndex?: number;
```

and set it in `PGHunk` before chunking, by walking `lines` once and numbering
only `add`/`rem` entries. That numbering is the wire contract from the plan
header — it must count exactly the `add`/`rem` lines and nothing else.

On each changed row in `PGDiffChunk`, add:

```tsx
          data-testid="diff-line-changed"
          data-selected={isSelected || undefined}
          onClick={(e) => onLineClick?.(ln.changedIndex!, e.shiftKey)}
          style={{
            /* ...existing row style..., plus: */
            cursor: onLineClick ? "pointer" : undefined,
            outline: isSelected
              ? "1px solid oklch(from var(--accent) l c h / 0.9)"
              : undefined,
          }}
```

- [ ] **Step 4: Own the selection in `CommitPanel`**

In `src/screens/CommitPanel.tsx`, add state keyed by hunk index:

```tsx
  // Line selection lives here, not in PGHunk: a primitive owning selection
  // plus the global key dispatcher would both answer the same input and the
  // selection would move twice (#61 D7).
  const [lineSel, setLineSel] = React.useState<Record<number, number[]>>({});
  const [lineAnchor, setLineAnchor] = React.useState<number | null>(null);

  // Indices stop meaning the same thing once the file or diff changes.
  React.useEffect(() => {
    setLineSel({});
    setLineAnchor(null);
  }, [selected?.path, selected?.side, diff]);
```

Pass into each `PGHunk`:

```tsx
                selectedLines={lineSel[i] ?? []}
                onLineClick={(changedIndex, range) => {
                  setLineSel((prev) => {
                    const cur = prev[i] ?? [];
                    if (range && lineAnchor != null) {
                      const [lo, hi] = [
                        Math.min(lineAnchor, changedIndex),
                        Math.max(lineAnchor, changedIndex),
                      ];
                      const span = [];
                      for (let k = lo; k <= hi; k++) span.push(k);
                      return { ...prev, [i]: span };
                    }
                    const next = cur.includes(changedIndex)
                      ? cur.filter((x) => x !== changedIndex)
                      : [...cur, changedIndex].sort((a, b) => a - b);
                    return { ...prev, [i]: next };
                  });
                  if (!range) setLineAnchor(changedIndex);
                }}
```

and make the existing `onStage` / `onDiscard` prefer the selection:

```tsx
                onStage={() => {
                  if (!selected) return;
                  const sel = lineSel[i] ?? [];
                  const store = useRepoStore.getState();
                  if (selected.side === "staged") {
                    sel.length
                      ? store.unstageLines(selected.path, i, sel)
                      : store.unstageHunk(selected.path, i);
                  } else {
                    sel.length
                      ? store.stageLines(selected.path, i, sel)
                      : store.stageHunk(selected.path, i);
                  }
                  setLineSel((prev) => ({ ...prev, [i]: [] }));
                }}
```

Do the same for `onDiscard` (`discardLines` vs `discardHunk`), keeping the
existing `pgConfirm` and naming the count in its body when a selection exists.

In `PGHunk`, make the button label reflect the count:

```tsx
          {selectedLines && selectedLines.length > 0
            ? `Stage ${selectedLines.length} lines`
            : staged
              ? "Staged"
              : "Stage hunk"}
```

`actionsDisabledReason` already disables the button while whitespace-ignore is
on, so the line ops inherit that gate with no extra work — which is required,
because ignore-whitespace rewrites hunk boundaries and the indices would not
address what git applies.

- [ ] **Step 5: Add Space-toggles-focused-line and Escape-clears**

The diff pane already registers with the keymap. Add to `CommitPanel`'s
existing pane key handling: `Space` toggles the focused changed line via the
same `onLineClick` path, and `Escape` clears `lineSel`. Do not add a local
`onKeyDown` to `PGHunk` — the global dispatcher owns keys.

- [ ] **Step 6: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/CommitPanel --run 2>&1 | tail -12 && pnpm tsc --noEmit
```
Expected: the three new tests pass, every existing CommitPanel test still passes, type-check clean.

- [ ] **Step 7: Commit**

```bash
git add src/design/git-components.tsx src/screens/CommitPanel.tsx src/screens/CommitPanel.lineStaging.test.tsx
git commit -m "feat(diff): select lines in a hunk and stage just those (#61 D7)

Why: selection state lives in the screen, not PGHunk — a primitive owning
selection plus the global key dispatcher both answer the same input and the
selection moves twice. Selection clears when the file or diff changes, since
the indices stop meaning the same thing. Whitespace-ignore already disables
the hunk buttons, so the line ops inherit that gate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full gate and PR

**Files:** none — verification only.

- [ ] **Step 1: Run every non-e2e gate**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit \
  && pnpm exec tsc -p e2e/tsconfig.json --noEmit \
  && pnpm test --run \
  && cargo test --manifest-path src-tauri/Cargo.toml \
  && pnpm vite build
```
Expected: all five clean.

- [ ] **Step 2: Rebuild the e2e snapshot and run the affected specs**

Both `src/` and `src-tauri/` changed, so the snapshot must be rebuilt or the run silently tests the old binary. Affected surfaces: staging and the diff view.

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/status-stage.e2e.ts --spec e2e/specs/commit.e2e.ts
```

Docker only. Never a native run.

- [ ] **Step 3: Squash and open the PR**

```bash
git fetch origin && git rebase origin/main
git reset --soft origin/main
git commit -F - <<'MSG'
feat(diff): issue #61 Tier 2 pt 2 — line-level staging and word diff

D7: patch_text_for_hunk generalizes to patch_text_for_lines (unselected '-'
becomes context, unselected '+' is dropped, swapped for reverse application,
@@ counts recomputed from the body); stage/unstage/discard_lines apply it via
the existing git_apply path. Click and shift-click select lines in a hunk;
the hunk button acts on the selection when there is one.

D8: new hand-rolled wordDiff over token LCS, no dependency added, with
similarity and length guards; PGDiffChunk tints changed spans within adjacent
rem/add line pairs.

Why the changed-line index contract: the frontend's hunk.lines carries header
and context rows while libgit2's line_in_hunk skips non-+/-/space origins, so
the wire contract is "index among the hunk's changed lines", which both sides
compute identically.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git push -u origin HEAD
gh pr create --fill
```

- [ ] **Step 4: Report** what passed, what the e2e run covered, and the PR URL.

---

## Self-review notes

**Spec coverage.** D7 → Tasks 1-3 (synthesis, ops, wiring) and Task 6 (selection UI, "Stage N lines" label, whitespace gate, selection clearing). D8 → Tasks 4-5 (pure function with both guards and the similarity gate; adjacent-pair rendering with relative-colour tints and memoization). The spec's D7/D8 test rows map to Tasks 1, 4, 5, 6 and the gate in Task 7.

**Two corrections to the spec, made while reading the code and folded in here:** the changed-line index contract (the two index spaces differ), and that `chunkDiffLines` groups by kind so pairing crosses adjacent chunks. The spec's D8 pairing paragraph was updated to match.

**Known follow-through:** Task 6 Steps 3-5 describe threading through code the implementer will have open, and Task 6 Step 1 says to copy `CommitPanel.whitespace.test.tsx`'s setup rather than re-inventing mocks. Every other step carries literal content.
