# Interactive rebase over merge commits — PR1: safety and execution model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive rebase can no longer leave a half-rewritten branch: plans are validated before the repository is touched, the replay happens on a detached HEAD with the branch ref updated only on completion, the operation's state lives on disk so Abort survives an app restart, and both the Rebase banner and the Conflict screen drive the same engine.

**Architecture:** `Libgit2Backend`'s hand-rolled rebase loop keeps its shape (a `VecDeque<RebaseStep>` popped one step at a time) but gains three collaborators: `git/rebase_plan.rs` validates a plan against the repository before `rebase_start` mutates anything, `git/rebase_state.rs` owns the on-disk `.git/platypusgit-rebase.json` mirror plus `ORIG_HEAD`, and the execution model detaches HEAD for the duration so the branch ref is a single atomic move at the end. On the frontend, base derivation moves out of the context menu into `planCommitSelection`, where `parents[0]` replaces the positional `commits[idx + 1]` guess.

**Tech Stack:** Rust + git2 0.20.4 (libgit2 1.9.2), serde/serde_json, Tauri 2 commands, React + Zustand, vitest/RTL, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-08-14-rebase-merge-commits-design.md`

## Global Constraints

- Every IPC-crossing fn returns `AppResult<T>`; no `unwrap`/`panic` in commands. Add `AppError` variants rather than stringifying.
- A new Rust `AppError` variant updates `src/lib/errors.ts` **in the same commit**. Wire format is `{ kind, message }`.
- New `GitBackend` trait methods get a `CliBackend` stub returning `AppError::NotImplemented`. (This PR adds no trait methods; keep it that way.)
- git2 work inside Tauri commands goes through `tokio::task::spawn_blocking`.
- Frontend never calls `invoke()` directly — typed wrapper in `src/lib/tauri.ts`.
- Never call `window.confirm` / `window.prompt` — `pgConfirm` / `pgPrompt` from `@/design`.
- Run cargo/pnpm with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- E2E only ever runs through Docker: `pnpm test:e2e:docker`. This PR adds no e2e spec.
- Do not write git's own `.git/rebase-merge/` directory. Our state file plus `ORIG_HEAD` is the contract.
- The seven existing tests in `src-tauri/tests/rebase.rs` must stay green throughout; they are the regression net for the execution-model change.

## File Structure

**Create:**
- `src-tauri/src/git/rebase_plan.rs` — plan validation against a repository: `validate`, `merge_legal`, `short`.
- `src-tauri/src/git/rebase_state.rs` — the on-disk mirror: `PersistedRebase`, `PersistedCurrent`, `path`, `save`, `load`, `clear`, `write_orig_head`.
- `src-tauri/tests/rebase_validation.rs` — validation rejections, each asserting the repository did not move.
- `src-tauri/tests/rebase_durability.rs` — detached-HEAD model, state file lifecycle, restart abort, delegation from `continue_operation` / `abort_operation`.
- `src/features/commits/planCommitSelection.merge.test.ts` — base + contiguity on non-linear history.

**Modify:**
- `src-tauri/src/error.rs` — `InvalidRebasePlan(String)` variant.
- `src-tauri/src/git/mod.rs` — `pub mod rebase_plan;`, `pub mod rebase_state;`.
- `src-tauri/src/git/libgit2.rs` — `RebaseState` fields, `rebase_start` / `advance_rebase` / `rebase_continue` / `rebase_abort` / `rebase_status` / `repo_state` / `continue_operation` / `abort_operation`.
- `src-tauri/tests/support/mod.rs` — `merge_history` fixture.
- `src-tauri/tests/rebase.rs` — add branch-ref assertions to the existing edit-pause test.
- `src/lib/errors.ts` — union member.
- `src/features/commits/planCommitSelection.ts` — `baseOid` from `parents[0]`, first-parent-chain `contiguous`.
- `src/design/context-menu.tsx` — the three single-commit entry points use the commit's parent; fixup/squash disabled on a merge with the reason in the label.

---

### Task 1: Reject an unexecutable plan before touching the repository

**Files:**
- Modify: `src-tauri/src/error.rs`
- Modify: `src/lib/errors.ts`
- Create: `src-tauri/src/git/rebase_plan.rs`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/git/libgit2.rs` (`rebase_start`, top of fn)
- Modify: `src-tauri/tests/support/mod.rs`
- Create: `src-tauri/tests/rebase_validation.rs`

**Interfaces:**
- Produces: `AppError::InvalidRebasePlan(String)`; `rebase_plan::validate(repo: &git2::Repository, plan: &[RebaseStep]) -> AppResult<()>`; `rebase_plan::merge_legal(action: RebaseAction) -> bool`; `rebase_plan::short(oid: &str) -> &str`; `support::MergeHistory { root, a, f, c, m }` and `support::merge_history(&TempRepo) -> MergeHistory`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/rebase_validation.rs`:

```rust
//! A plan the engine cannot execute must be refused before the repository is
//! touched. The bug this pins: a merge commit in the plan used to surface
//! libgit2's "mainline branch is not specified" error on the step that reached
//! it — after earlier picks had already been committed and the branch tip
//! moved.

mod support;

use platypusgit_lib::{
    error::AppError,
    git::{
        types::{RebaseAction, RebaseStep},
        GitBackend,
    },
};

use support::{merge_history, TempRepo};

fn step(oid: &str, action: RebaseAction) -> RebaseStep {
    RebaseStep { oid: oid.to_string(), action, message: None }
}

/// Every rejection must leave HEAD, the branch ref, and the worktree exactly
/// as they were.
fn assert_untouched(tr: &TempRepo, head_before: &str) {
    let head_now = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();
    assert_eq!(head_now, head_before, "HEAD moved on a rejected plan");
    let branch = tr
        .repo
        .find_reference("refs/heads/main")
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();
    assert_eq!(branch, head_before, "branch ref moved on a rejected plan");
    assert!(
        tr.repo.statuses(None).unwrap().is_empty(),
        "worktree dirtied by a rejected plan"
    );
}

#[test]
fn merge_commit_with_pick_is_rejected_before_anything_moves() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let head_before = h.m.clone();

    let plan = vec![
        step(&h.a, RebaseAction::Pick),
        step(&h.f, RebaseAction::Pick),
        step(&h.c, RebaseAction::Pick),
        step(&h.m, RebaseAction::Pick), // the merge
    ];

    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    match err {
        AppError::InvalidRebasePlan(msg) => {
            assert!(msg.contains(&h.m[..7]), "message should name the merge: {msg}");
            assert!(msg.contains("merge"), "message should say why: {msg}");
        }
        other => panic!("expected InvalidRebasePlan, got {other:?}"),
    }
    assert_untouched(&tr, &head_before);
    assert!(!backend.rebase_status(&handle.id).unwrap().in_progress);
}

#[test]
fn merge_commit_may_be_dropped() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let plan = vec![
        step(&h.a, RebaseAction::Pick),
        step(&h.f, RebaseAction::Pick),
        step(&h.c, RebaseAction::Pick),
        step(&h.m, RebaseAction::Drop),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(!status.in_progress, "flattening plan should run to completion");
    let summaries: Vec<String> = backend
        .log(&handle.id, None, 20)
        .unwrap()
        .into_iter()
        .map(|c| c.summary)
        .collect();
    assert!(summaries.iter().any(|s| s == "F on feature"));
    assert!(!summaries.iter().any(|s| s.starts_with("Merge branch")));
}

#[test]
fn duplicate_oid_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let head_before = h.m.clone();

    let plan = vec![step(&h.a, RebaseAction::Pick), step(&h.a, RebaseAction::Pick)];
    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
    assert_untouched(&tr, &head_before);
}

#[test]
fn unknown_oid_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let head_before = h.m.clone();

    let plan = vec![step("0000000000000000000000000000000000000000", RebaseAction::Pick)];
    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
    assert_untouched(&tr, &head_before);
}

#[test]
fn all_drop_plan_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let head_before = h.m.clone();

    let plan = vec![step(&h.a, RebaseAction::Drop)];
    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
    assert_untouched(&tr, &head_before);
}
```

Add the fixture to `src-tauri/tests/support/mod.rs` (append at the end, next to `linear_history`):

```rust
/// A repository with a merge commit in the middle of the range:
///
/// ```text
/// root ── A ──── C ── M      (main)
///          \        /
///           ─── F ──         (feature)
/// ```
///
/// `F` and `C` touch different files, so `M` is a clean merge. Returns the oids
/// as strings, oldest first.
pub struct MergeHistory {
    pub root: String,
    pub a: String,
    pub f: String,
    pub c: String,
    pub m: String,
}

pub fn merge_history(tr: &TempRepo) -> MergeHistory {
    use self::fs::write_file;

    let root = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    let commit = |name: &str, body: &str, msg: &str| -> String {
        write_file(tr.path(), name, body);
        let mut index = tr.repo.index().unwrap();
        index.add_path(std::path::Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = tr.repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&head])
            .unwrap()
            .to_string()
    };

    let a = commit("a.txt", "a\n", "A on main");

    // feature branches off A
    let a_commit = tr.repo.find_commit(git2::Oid::from_str(&a).unwrap()).unwrap();
    tr.repo.branch("feature", &a_commit, false).unwrap();
    tr.repo.set_head("refs/heads/feature").unwrap();
    tr.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let f = commit("f.txt", "f\n", "F on feature");

    // back to main
    tr.repo.set_head("refs/heads/main").unwrap();
    tr.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let c = commit("c.txt", "c\n", "C on main");

    // merge feature into main
    let f_oid = git2::Oid::from_str(&f).unwrap();
    let annotated = tr.repo.find_annotated_commit(f_oid).unwrap();
    tr.repo.merge(&[&annotated], None, None).unwrap();
    let mut index = tr.repo.index().unwrap();
    assert!(!index.has_conflicts(), "merge_history fixture must merge cleanly");
    let tree = tr.repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = Signature::now("Test", "test@example.com").unwrap();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let f_commit = tr.repo.find_commit(f_oid).unwrap();
    let m = tr
        .repo
        .commit(
            Some("HEAD"),
            &sig,
            &sig,
            "Merge branch 'feature'",
            &tree,
            &[&head, &f_commit],
        )
        .unwrap()
        .to_string();
    tr.repo.cleanup_state().unwrap();

    MergeHistory { root, a, f, c, m }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_validation
```

Expected: compile error — `AppError::InvalidRebasePlan` does not exist. After the variant is added but before validation is wired, expect `merge_commit_with_pick_is_rejected_before_anything_moves` to fail with `expected InvalidRebasePlan, got Git("mainline branch is not specified but …")` and the `assert_untouched` HEAD assertion to fail — that is the bug reproduced.

- [ ] **Step 3: Add the error variant (Rust + TS, same commit)**

In `src-tauri/src/error.rs`, after the `DubiousOwnership` variant:

```rust
    /// A rebase plan the engine cannot execute — a merge commit carrying an
    /// action that has no meaning for it, a duplicate or unknown oid, a plan
    /// that drops everything. Raised by `rebase_plan::validate` *before*
    /// `rebase_start` moves anything, so the repository is untouched when the
    /// frontend shows it.
    #[error("invalid rebase plan: {0}")]
    InvalidRebasePlan(String),
```

In `src/lib/errors.ts`, add to the union (keep it 1:1 with the Rust enum):

```ts
  | { kind: "InvalidRebasePlan"; message: string }
```

- [ ] **Step 4: Write the validator**

Create `src-tauri/src/git/rebase_plan.rs`:

```rust
//! Validation of an interactive-rebase plan against the repository it will run
//! against. Every check here runs *before* `rebase_start` mutates anything: the
//! engine used to discover an unexecutable step mid-replay, with earlier picks
//! already committed and the branch tip already moved.

use std::collections::HashSet;

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::types::{RebaseAction, RebaseStep};

/// First seven hex characters, for messages.
pub fn short(oid: &str) -> &str {
    &oid[..oid.len().min(7)]
}

/// Actions that mean something for a commit with more than one parent.
///
/// PR1 allows only `Drop` (git's own default: merges are dropped and the branch
/// is flattened). PR2 adds `MainlinePick`, PR3 adds `Merge`.
pub fn merge_legal(action: RebaseAction) -> bool {
    matches!(action, RebaseAction::Drop)
}

pub fn validate(repo: &Repository, plan: &[RebaseStep]) -> AppResult<()> {
    if plan.is_empty() {
        return Err(AppError::InvalidRebasePlan("the plan is empty".into()));
    }

    let mut seen: HashSet<&str> = HashSet::new();
    for step in plan {
        if !seen.insert(step.oid.as_str()) {
            return Err(AppError::InvalidRebasePlan(format!(
                "{} appears twice in the plan",
                short(&step.oid)
            )));
        }

        let commit = repo
            .revparse_single(&step.oid)
            .and_then(|o| o.peel_to_commit())
            .map_err(|_| {
                AppError::InvalidRebasePlan(format!("unknown commit {}", short(&step.oid)))
            })?;

        if commit.parent_count() > 1 && !merge_legal(step.action) {
            return Err(AppError::InvalidRebasePlan(format!(
                "{} is a merge commit — it can only be dropped, which flattens \
                 the branch, or left out of the plan",
                short(&step.oid)
            )));
        }
    }

    if !plan.iter().any(|s| s.action != RebaseAction::Drop) {
        return Err(AppError::InvalidRebasePlan(
            "the plan drops every commit — nothing would be replayed".into(),
        ));
    }

    Ok(())
}
```

Declare it in `src-tauri/src/git/mod.rs` next to the other module declarations:

```rust
pub mod rebase_plan;
```

`RebaseAction` needs `PartialEq` + `Copy` for the matches above; it already derives `PartialEq` (used as `step.action == RebaseAction::Drop` in `advance_rebase`). If `Copy` is missing, add `Copy` to its derive list in `src-tauri/src/git/types.rs`.

- [ ] **Step 5: Call it first in `rebase_start`**

In `src-tauri/src/git/libgit2.rs`, replace the empty-plan guard at the top of `rebase_start` (currently `if plan.is_empty() { … }` plus the `find(|s| s.action != RebaseAction::Drop)` lookup that raises `"rebase plan contains only drops"`) with a validation call, keeping the first-step lookup for the base:

```rust
    fn rebase_start(&self, repo_id: &RepoId, plan: Vec<RebaseStep>) -> AppResult<RebaseStatus> {
        self.with_repo(repo_id, |repo| crate::git::rebase_plan::validate(repo, &plan))?;

        // Validated above, so this cannot fail: a plan with at least one
        // non-Drop step exists.
        let first_step = plan
            .iter()
            .find(|s| s.action != RebaseAction::Drop)
            .ok_or_else(|| AppError::InvalidRebasePlan("the plan drops every commit".into()))?;
        let first_oid_str = first_step.oid.clone();
        // … existing dirty-worktree check, orig_head capture, reset …
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_validation
cargo test --manifest-path src-tauri/Cargo.toml --test rebase
pnpm tsc --noEmit
```

Expected: all five new tests pass, all seven existing rebase tests still pass, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/git/rebase_plan.rs src-tauri/src/git/mod.rs \
        src-tauri/src/git/libgit2.rs src-tauri/tests/rebase_validation.rs \
        src-tauri/tests/support/mod.rs src/lib/errors.ts
git commit -m "fix(rebase): validate the plan before touching the repository

Why: a merge commit in the plan surfaced libgit2's \"mainline branch is
not specified\" error on the step that reached it, with earlier picks
already committed and the branch tip already moved. Validation now runs
first, so a rejected plan leaves HEAD, the branch, and the worktree
untouched."
```

---

### Task 2: Replay on a detached HEAD; move the branch only on completion

**Files:**
- Modify: `src-tauri/src/git/libgit2.rs` (`RebaseState`, `rebase_start`, `advance_rebase`, `rebase_abort`)
- Create: `src-tauri/tests/rebase_durability.rs`
- Modify: `src-tauri/tests/rebase.rs` (`rebase_edit_pauses_and_continue_resumes`)

**Interfaces:**
- Consumes: `rebase_plan::validate` (Task 1), `support::merge_history` (Task 1).
- Produces: `RebaseState { plan, total, completed, pause_reason, conflict_step, orig_head, head_name: Option<String>, rewritten: HashMap<String, String> }`; `Libgit2Backend::finish_rebase(&self, repo_id) -> AppResult<()>` (moves the branch ref and reattaches HEAD).

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/rebase_durability.rs`:

```rust
//! The execution model: a rebase replays on a detached HEAD and moves the
//! branch ref exactly once, when the plan completes. Anything that fails or
//! pauses mid-way therefore leaves the branch where it was.

mod support;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseStep},
    GitBackend,
};

use support::{linear_history, TempRepo};

fn step(oid: &str, action: RebaseAction) -> RebaseStep {
    RebaseStep { oid: oid.to_string(), action, message: None }
}

fn branch_tip(tr: &TempRepo, name: &str) -> String {
    tr.repo
        .find_reference(&format!("refs/heads/{name}"))
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string()
}

#[test]
fn paused_rebase_detaches_head_and_leaves_the_branch_alone() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let tip_before = branch_tip(&tr, "main");

    let (backend, handle) = tr.open_with_backend();
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Edit), // pauses here
        step(&oids[2], RebaseAction::Pick),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(status.in_progress, "edit should pause the rebase");
    assert_eq!(status.pause_reason.as_deref(), Some("edit"));

    assert!(
        tr.repo.head_detached().unwrap(),
        "HEAD must be detached while a rebase is replaying"
    );
    assert_eq!(
        branch_tip(&tr, "main"),
        tip_before,
        "the branch ref must not move until the plan completes"
    );

    let done = backend.rebase_continue(&handle.id).unwrap();
    assert!(!done.in_progress, "rebase should finish after continue");
    assert!(
        !tr.repo.head_detached().unwrap(),
        "HEAD must be back on the branch when the plan completes"
    );
    assert_eq!(
        tr.repo.head().unwrap().name().unwrap(),
        "refs/heads/main",
        "HEAD should be reattached to the original branch"
    );
    let tip_after = branch_tip(&tr, "main");
    assert_ne!(tip_after, tip_before, "the branch should point at the replay");
    assert_eq!(
        tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string(),
        tip_after,
        "HEAD and the branch must agree once the rebase is done"
    );
}

#[test]
fn abort_mid_rebase_restores_the_branch_and_reattaches_head() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let tip_before = branch_tip(&tr, "main");

    let (backend, handle) = tr.open_with_backend();
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Edit),
        step(&oids[2], RebaseAction::Pick),
    ];
    backend.rebase_start(&handle.id, plan).unwrap();

    backend.rebase_abort(&handle.id).unwrap();

    assert!(!tr.repo.head_detached().unwrap(), "abort must reattach HEAD");
    assert_eq!(tr.repo.head().unwrap().name().unwrap(), "refs/heads/main");
    assert_eq!(branch_tip(&tr, "main"), tip_before);
    assert_eq!(
        tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string(),
        tip_before
    );
    assert!(tr.repo.statuses(None).unwrap().is_empty(), "worktree left dirty");
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_durability
```

Expected: `paused_rebase_detaches_head_and_leaves_the_branch_alone` fails at the `head_detached` assertion — today the engine commits straight to the attached branch, so HEAD is attached and the branch tip has already moved.

- [ ] **Step 3: Extend `RebaseState`**

In `src-tauri/src/git/libgit2.rs`, add two fields to `RebaseState` (keep the existing doc comments):

```rust
    /// Full ref name of the branch HEAD pointed at when the rebase started
    /// (`refs/heads/…`), or `None` when it started from a detached HEAD. The
    /// replay runs detached; this ref is moved exactly once, when the plan
    /// completes.
    pub head_name: Option<String>,
    /// Original oid → rewritten oid for every step that has run. A dropped or
    /// skipped step maps to the HEAD it left behind, so a later step that has
    /// to sit on top of it still resolves to a real commit.
    pub rewritten: HashMap<String, String>,
```

- [ ] **Step 4: Detach in `rebase_start`**

Replace the reset at the end of `rebase_start`'s `with_repo` closure so it records the branch and detaches instead of moving the branch:

```rust
        let (orig_head, head_name) = self.with_repo(repo_id, |repo| {
            // … existing dirty-worktree check, unchanged …

            let head_ref = repo.head()?;
            let head_name = if repo.head_detached()? {
                None
            } else {
                head_ref.name().map(|s| s.to_string())
            };
            let orig_head = head_ref.peel_to_commit()?.id().to_string();

            let first_commit = repo
                .revparse_single(&first_oid_str)
                .map_err(|_| AppError::InvalidRef(first_oid_str.clone()))?
                .peel_to_commit()?;
            let parent = first_commit.parent(0).map_err(|_| {
                AppError::InvalidRebasePlan(format!(
                    "{} has no parent to rebase onto",
                    crate::git::rebase_plan::short(&first_oid_str)
                ))
            })?;

            // Detach first, then hard-reset: with HEAD attached, the reset
            // would drag the branch ref along, which is exactly what must not
            // happen until the plan completes.
            repo.set_head_detached(parent.id())?;
            repo.reset(parent.as_object(), git2::ResetType::Hard, None)?;
            Ok((orig_head, head_name))
        })?;
```

Insert both into the `RebaseState` literal: `head_name`, `rewritten: HashMap::new()`.

- [ ] **Step 5: Reattach when the plan is exhausted**

Add a helper next to `bump_completed` in the `impl Libgit2Backend` block:

```rust
    /// Point the original branch at the replayed history and reattach HEAD to
    /// it. Called once, when the plan is exhausted. A rebase that started from
    /// a detached HEAD just stays detached.
    fn finish_rebase(&self, repo_id: &RepoId) -> AppResult<()> {
        let head_name = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.get(repo_id).and_then(|s| s.head_name.clone())
        };
        let Some(head_name) = head_name else { return Ok(()) };

        self.with_repo(repo_id, |repo| {
            let tip = repo.head()?.peel_to_commit()?.id();
            repo.reference(&head_name, tip, true, "rebase (finish)")?;
            repo.set_head(&head_name)?;
            Ok(())
        })
    }
```

In `advance_rebase`, call it in the plan-exhausted arm, before the status snapshot:

```rust
            let Some(step) = step else {
                // Plan exhausted — move the branch to the replayed history and
                // reattach HEAD before reporting, so the caller's refresh sees
                // the finished state.
                self.finish_rebase(repo_id)?;
                let status = self.rebase_status(repo_id)?;
                // … existing state removal, unchanged …
```

Also record each step's result: after `self.finish_pick(repo_id, &step.oid)?` and in the `Drop` early-continue path, insert the mapping. Add a second helper beside `bump_completed`:

```rust
    fn record_rewritten(&self, repo_id: &RepoId, old: &str) -> AppResult<()> {
        let new = self.with_repo(repo_id, |repo| {
            Ok(repo.head()?.peel_to_commit()?.id().to_string())
        })?;
        let mut rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if let Some(state) = rebases.get_mut(repo_id) {
            state.rewritten.insert(old.to_string(), new);
        }
        Ok(())
    }
```

Call `self.record_rewritten(repo_id, &step.oid)?;` immediately after the `Drop` fast-path's `bump_completed` and immediately after `finish_pick` in the main path. (PR3 is what reads the map; recording it here keeps the two changes independent.)

- [ ] **Step 6: Reattach in `rebase_abort`**

Replace `rebase_abort`'s body after the state removal:

```rust
        let removed = {
            let mut rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.remove(repo_id)
        };
        let orig_head = removed.as_ref().map(|s| s.orig_head.clone());
        let head_name = removed.and_then(|s| s.head_name);

        self.with_repo(repo_id, |repo| {
            repo.cleanup_state()?;
            // The branch never moved (the replay ran detached), so abort is
            // "put HEAD back on the branch and drop the replay".
            match (&head_name, &orig_head) {
                (Some(name), _) => {
                    repo.set_head(name)?;
                    let target = repo.head()?.peel_to_commit()?;
                    repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
                }
                (None, Some(oid)) => {
                    let target = repo.revparse_single(oid)?.peel_to_commit()?;
                    repo.set_head_detached(target.id())?;
                    repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
                }
                (None, None) => {
                    let target = repo.head()?.peel_to_commit()?;
                    repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
                }
            }
            Ok(())
        })
```

- [ ] **Step 7: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_durability
cargo test --manifest-path src-tauri/Cargo.toml --test rebase
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_validation
```

Expected: both new tests pass; the seven existing rebase tests and the five validation tests still pass. If `rebase_abort_resets_to_pre_rebase_head` or `abort_operation_clears_rebase_state_and_restores_pre_rebase_head` fails, the assertion to check is whether it inspects `HEAD` while expecting an attached branch — the branch is now the authority, and both should still hold.

- [ ] **Step 8: Pin the model in the existing edit test**

In `src-tauri/tests/rebase.rs`, inside `rebase_edit_pauses_and_continue_resumes`, after the pause is asserted, add:

```rust
    assert!(
        tr.repo.head_detached().unwrap(),
        "the replay must run on a detached HEAD"
    );
```

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/git/libgit2.rs src-tauri/tests/rebase_durability.rs src-tauri/tests/rebase.rs
git commit -m "fix(rebase): replay on a detached HEAD, move the branch on completion

Why: the engine committed straight to the attached branch, so a failure
or pause left the branch pointing mid-replay and abort had to guess its
way back. The branch ref is now a single move at the end, which is also
what makes replaying a side branch possible at all."
```

---

### Task 3: Mirror the rebase to disk so Abort survives a restart

**Files:**
- Create: `src-tauri/src/git/rebase_state.rs`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/git/libgit2.rs` (`rebase_start`, `advance_rebase`, `mark_paused`, `rebase_abort`, `rebase_status`, `repo_state`)
- Modify: `src-tauri/tests/rebase_durability.rs`

**Interfaces:**
- Consumes: `RebaseState` fields from Task 2.
- Produces: `rebase_state::PersistedRebase`, `rebase_state::PersistedCurrent`, `rebase_state::path(repo) -> PathBuf`, `rebase_state::save(repo, &PersistedRebase) -> AppResult<()>`, `rebase_state::load(repo) -> AppResult<Option<PersistedRebase>>`, `rebase_state::clear(repo) -> AppResult<()>`, `rebase_state::write_orig_head(repo, oid) -> AppResult<()>`; `Libgit2Backend::persist_rebase(&self, repo_id) -> AppResult<()>`.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/rebase_durability.rs`:

```rust
use platypusgit_lib::git::{libgit2::Libgit2Backend, types::RepoState};

#[test]
fn a_paused_rebase_is_visible_on_disk_and_reports_as_a_rebase() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);

    let (backend, handle) = tr.open_with_backend();
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Edit),
        step(&oids[2], RebaseAction::Pick),
    ];
    backend.rebase_start(&handle.id, plan).unwrap();

    let state_file = tr.path().join(".git").join("platypusgit-rebase.json");
    assert!(state_file.exists(), "a paused rebase must be recorded on disk");
    assert!(
        tr.path().join(".git").join("ORIG_HEAD").exists(),
        "ORIG_HEAD is the CLI escape hatch and must be written"
    );
    assert_eq!(
        backend.repo_state(&handle.id).unwrap(),
        RepoState::RebaseInteractive,
        "a paused rebase must report as a rebase, not as Clean or CherryPick"
    );

    backend.rebase_continue(&handle.id).unwrap();
    assert!(
        !state_file.exists(),
        "the state file must be swept when the plan completes"
    );
    assert_eq!(backend.repo_state(&handle.id).unwrap(), RepoState::Clean);
}

#[test]
fn a_restarted_app_can_still_abort() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let tip_before = branch_tip(&tr, "main");

    {
        let (backend, handle) = tr.open_with_backend();
        let plan = vec![
            step(&oids[0], RebaseAction::Pick),
            step(&oids[1], RebaseAction::Edit),
            step(&oids[2], RebaseAction::Pick),
        ];
        backend.rebase_start(&handle.id, plan).unwrap();
    } // backend dropped — every trace of the in-memory RebaseState is gone

    // A fresh backend is what the app has after a restart.
    let backend = Libgit2Backend::new();
    let handle = backend.open(tr.path()).unwrap();

    let status = backend.rebase_status(&handle.id).unwrap();
    assert!(
        status.in_progress,
        "the rebase must still be reported as in progress after a restart"
    );
    assert_eq!(status.total, 3);
    assert_eq!(status.next_index, 1, "one step had completed before the pause");

    backend.rebase_abort(&handle.id).unwrap();
    assert_eq!(branch_tip(&tr, "main"), tip_before);
    assert!(!tr.repo.head_detached().unwrap());
    assert!(!tr.path().join(".git").join("platypusgit-rebase.json").exists());
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_durability
```

Expected: `a_paused_rebase_is_visible_on_disk_and_reports_as_a_rebase` fails on the missing state file; `a_restarted_app_can_still_abort` fails because `rebase_status` on a fresh backend reports `in_progress: false`.

- [ ] **Step 3: Write the state module**

Create `src-tauri/src/git/rebase_state.rs`:

```rust
//! The on-disk mirror of an in-progress interactive rebase.
//!
//! The engine's `RebaseState` lives in a `HashMap` inside `Libgit2Backend`, so
//! before this existed, closing the app during a rebase left a detached HEAD
//! part-way through a replay with no way back but the reflog. This module keeps
//! a JSON mirror in the gitdir and writes `ORIG_HEAD` the way git does, so both
//! the app and the `git` CLI can recover.
//!
//! Deliberately NOT git's own `.git/rebase-merge/` directory: a
//! half-compatible one would make `git status` and `git rebase --continue`
//! claim authority over a rebase they cannot drive.

use std::{collections::BTreeMap, path::PathBuf};

use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::types::RebaseStep;

pub const FILE_NAME: &str = "platypusgit-rebase.json";
pub const VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedCurrent {
    pub step: RebaseStep,
    /// "conflict" | "edit" — mirrors `RebaseStatus.pause_reason`.
    pub phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedRebase {
    pub version: u32,
    /// Branch to move when the plan completes; `None` when the rebase started
    /// from a detached HEAD.
    pub head_name: Option<String>,
    pub orig_head: String,
    pub onto: String,
    pub total: usize,
    pub completed: usize,
    pub remaining: Vec<RebaseStep>,
    /// Why the rebase is paused — "conflict" | "edit" | absent. Persisted
    /// separately from `current` because an edit pause has no held-back step:
    /// its commit already landed.
    pub pause_reason: Option<String>,
    /// The step whose apply conflicted and is awaiting resolution, if any.
    pub current: Option<PersistedCurrent>,
    pub rewritten: BTreeMap<String, String>,
}

pub fn path(repo: &Repository) -> PathBuf {
    repo.path().join(FILE_NAME)
}

/// Write via temp file + rename so a crash mid-write cannot leave a truncated
/// state file that would read as "no rebase in progress".
pub fn save(repo: &Repository, state: &PersistedRebase) -> AppResult<()> {
    let target = path(repo);
    let tmp = target.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(state)
        .map_err(|e| AppError::Internal(format!("serialising rebase state: {e}")))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// `Ok(None)` when there is no file. A file we cannot parse is an error, not a
/// silent "no rebase": guessing here is how a half-replayed branch would lose
/// its way back.
pub fn load(repo: &Repository) -> AppResult<Option<PersistedRebase>> {
    let target = path(repo);
    match std::fs::read(&target) {
        Ok(bytes) => {
            let state: PersistedRebase = serde_json::from_slice(&bytes).map_err(|e| {
                AppError::Internal(format!("unreadable rebase state in {FILE_NAME}: {e}"))
            })?;
            if state.version != VERSION {
                return Err(AppError::Internal(format!(
                    "{FILE_NAME} was written by another version ({}), refusing to guess",
                    state.version
                )));
            }
            Ok(Some(state))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn clear(repo: &Repository) -> AppResult<()> {
    match std::fs::remove_file(path(repo)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// `ORIG_HEAD`, written the way git writes it before a history-rewriting
/// operation, so `git reset --hard ORIG_HEAD` works from the CLI.
pub fn write_orig_head(repo: &Repository, oid: &str) -> AppResult<()> {
    let target = repo.path().join("ORIG_HEAD");
    std::fs::write(target, format!("{oid}\n"))?;
    Ok(())
}
```

Declare it in `src-tauri/src/git/mod.rs`:

```rust
pub mod rebase_state;
```

- [ ] **Step 4: Persist from the engine**

Add a helper next to `record_rewritten` in `src-tauri/src/git/libgit2.rs`:

```rust
    /// Mirror the in-memory rebase to the gitdir. Called after every state
    /// transition; a missing in-memory entry means the rebase is over, so the
    /// file goes away.
    fn persist_rebase(&self, repo_id: &RepoId) -> AppResult<()> {
        let snapshot = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.get(repo_id).map(|s| crate::git::rebase_state::PersistedRebase {
                version: crate::git::rebase_state::VERSION,
                head_name: s.head_name.clone(),
                orig_head: s.orig_head.clone(),
                onto: s.onto.clone(),
                total: s.total,
                completed: s.completed,
                remaining: s.plan.iter().cloned().collect(),
                pause_reason: s.pause_reason.clone(),
                current: s.conflict_step.clone().map(|step| {
                    crate::git::rebase_state::PersistedCurrent {
                        step,
                        phase: s.pause_reason.clone().unwrap_or_else(|| "conflict".into()),
                    }
                }),
                rewritten: s.rewritten.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            })
        };

        self.with_repo(repo_id, |repo| match &snapshot {
            Some(state) => crate::git::rebase_state::save(repo, state),
            None => crate::git::rebase_state::clear(repo),
        })
    }
```

`RebaseState` needs an `onto: String` field (the base the replay started from) for the snapshot — add it beside `orig_head`, set it in `rebase_start` to `parent.id().to_string()`, and note in its doc comment that it is what a resumed session resets to. `RebaseStep` must derive `Clone` (it already does) and `Deserialize` (it already does).

Call `self.persist_rebase(repo_id)?;`:
- at the end of `rebase_start`, right after the `rebases.insert(…)` and `drop(rebases)`, **before** `advance_rebase`;
- at the end of `mark_paused`, before it returns the status;
- in `advance_rebase` after each `bump_completed`;
- in the plan-exhausted arm after the in-memory entry is removed (which clears the file).

In `rebase_start`, also write `ORIG_HEAD` inside the same `with_repo` closure that captures `orig_head`:

```rust
            crate::git::rebase_state::write_orig_head(repo, &orig_head)?;
```

In `rebase_abort`, clear the file inside the existing `with_repo` closure:

```rust
            crate::git::rebase_state::clear(repo)?;
```

- [ ] **Step 5: Read the file back in `rebase_status` and `repo_state`**

Replace `rebase_status`'s `None` arm so it falls back to disk:

```rust
    fn rebase_status(&self, repo_id: &RepoId) -> AppResult<RebaseStatus> {
        let in_memory = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.get(repo_id).map(|state| RebaseStatus {
                in_progress: state.completed < state.total || state.pause_reason.is_some(),
                next_index: state.completed,
                total: state.total,
                pause_reason: state.pause_reason.clone(),
            })
        };
        if let Some(status) = in_memory {
            return Ok(status);
        }

        // No in-memory entry: either there is no rebase, or this process did
        // not start it (the app was restarted mid-rebase). The state file is
        // the authority in that case.
        self.with_repo(repo_id, |repo| {
            Ok(match crate::git::rebase_state::load(repo)? {
                Some(state) => RebaseStatus {
                    in_progress: true,
                    next_index: state.completed,
                    total: state.total,
                    pause_reason: state.pause_reason,
                },
                None => RebaseStatus {
                    in_progress: false,
                    next_index: 0,
                    total: 0,
                    pause_reason: None,
                },
            })
        })
    }
```

And give the state file precedence in `repo_state`, so a paused pick reports as a rebase rather than as `CherryPick` (which is what libgit2 sees, because the pause leaves `CHERRY_PICK_HEAD` behind):

```rust
    fn repo_state(&self, repo_id: &RepoId) -> AppResult<RepoState> {
        self.with_repo(repo_id, |repo| {
            // Our own rebase wins: libgit2 only sees the CHERRY_PICK_HEAD /
            // MERGE_HEAD a paused step leaves behind, which would report the
            // step's mechanism instead of the operation the user started.
            if crate::git::rebase_state::load(repo)?.is_some() {
                return Ok(RepoState::RebaseInteractive);
            }
            use git2::RepositoryState as RS;
            // … existing match, unchanged …
        })
    }
```

`RepoState` needs `PartialEq` for the test's `assert_eq!`; add it to the derive list in `src-tauri/src/git/types.rs` if missing (it is a plain C-like enum, so `#[derive(Debug, Clone, Copy, PartialEq, Serialize)]`).

- [ ] **Step 6: Rehydrate, so a restarted app can continue as well as abort**

Add a helper beside `persist_rebase` that rebuilds the in-memory state from the file:

```rust
    /// Rebuild the in-memory rebase from the state file. Used when this process
    /// did not start the rebase — the app was restarted mid-operation — so that
    /// Continue and Abort work the same as they would have in the original
    /// session. Returns false when there is no rebase on disk.
    fn rehydrate_rebase(&self, repo_id: &RepoId) -> AppResult<bool> {
        let Some(p) = self.with_repo(repo_id, crate::git::rebase_state::load)? else {
            return Ok(false);
        };
        let mut rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        rebases.insert(
            repo_id.clone(),
            RebaseState {
                plan: p.remaining.into_iter().collect(),
                total: p.total,
                completed: p.completed,
                pause_reason: p.pause_reason,
                conflict_step: p.current.map(|c| c.step),
                orig_head: p.orig_head,
                onto: p.onto,
                head_name: p.head_name,
                rewritten: p.rewritten.into_iter().collect(),
            },
        );
        Ok(true)
    }
```

At the top of `rebase_continue`, before the unresolved-conflict check:

```rust
        // A rebase started by an earlier session has no in-memory entry; its
        // plan, progress, and rewritten map are all on disk.
        let known = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.contains_key(repo_id)
        };
        if !known && !self.rehydrate_rebase(repo_id)? {
            return Err(AppError::InvalidRef("no rebase in progress".into()));
        }
```

`rebase_abort` also tolerates a missing entry; make it read the file so a restarted app aborts correctly:

```rust
    fn rebase_abort(&self, repo_id: &RepoId) -> AppResult<()> {
        let removed = {
            let mut rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.remove(repo_id)
        };

        let (orig_head, head_name) = match removed {
            Some(s) => (Some(s.orig_head), s.head_name),
            None => {
                // Restarted mid-rebase: the file is all we have.
                let persisted = self.with_repo(repo_id, crate::git::rebase_state::load)?;
                match persisted {
                    Some(p) => (Some(p.orig_head), p.head_name),
                    None => (None, None),
                }
            }
        };
        // … existing reattach/reset body from Task 2, plus rebase_state::clear …
```

Then extend the restart test in `src-tauri/tests/rebase_durability.rs` so continuing after a restart is covered too — add this test below `a_restarted_app_can_still_abort`:

```rust
#[test]
fn a_restarted_app_can_still_continue() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);

    {
        let (backend, handle) = tr.open_with_backend();
        backend
            .rebase_start(
                &handle.id,
                vec![
                    step(&oids[0], RebaseAction::Pick),
                    step(&oids[1], RebaseAction::Edit),
                    step(&oids[2], RebaseAction::Pick),
                ],
            )
            .unwrap();
    } // restart

    let backend = Libgit2Backend::new();
    let handle = backend.open(tr.path()).unwrap();

    let done = backend.rebase_continue(&handle.id).unwrap();
    assert!(!done.in_progress, "the rehydrated plan should run to completion");
    assert_eq!(done.total, 3);
    assert!(!tr.repo.head_detached().unwrap(), "HEAD reattached on completion");
    let summaries: Vec<String> = backend
        .log(&handle.id, None, 10)
        .unwrap()
        .into_iter()
        .map(|c| c.summary)
        .collect();
    assert_eq!(summaries[0], "commit 2", "the last step must have been replayed");
}
```

- [ ] **Step 7: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_durability
cargo test --manifest-path src-tauri/Cargo.toml --test rebase
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_validation
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: everything passes, including the full backend suite (`conflict.rs` and any other test that asserts `repo_state` — the new precedence only applies when our state file exists).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/rebase_state.rs src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs \
        src-tauri/src/git/types.rs src-tauri/tests/rebase_durability.rs
git commit -m "feat(rebase): mirror an in-progress rebase to the gitdir

Why: abort-ability lived only in Libgit2Backend's HashMap, and
repo_state reported Clean, so closing the app mid-rebase left a detached
replay with no route back but the reflog. State now lives in
.git/platypusgit-rebase.json with ORIG_HEAD alongside it, so a restarted
app still reports the rebase and can abort it."
```

---

### Task 4: One engine behind both Continue and Abort

**Files:**
- Modify: `src-tauri/src/git/libgit2.rs` (`continue_operation`, `abort_operation`)
- Modify: `src-tauri/tests/rebase_durability.rs`

**Interfaces:**
- Consumes: `rebase_state::load` (Task 3), `rebase_continue` / `rebase_abort` (Tasks 2–3).
- Produces: no new API — behaviour change only.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/rebase_durability.rs`:

```rust
use platypusgit_lib::git::types::ResetMode;
use support::fs::write_file;
use std::path::PathBuf;

/// main and a rewritten history both touch `shared.txt`, so replaying the
/// second commit conflicts.
fn conflicting_plan_repo() -> (TempRepo, Vec<String>) {
    let tr = TempRepo::with_initial_commit("root\n");
    let mut oids = Vec::new();
    for (body, msg) in [("one\n", "first"), ("two\n", "second")] {
        write_file(tr.path(), "shared.txt", body);
        oids.push(tr.commit_all(msg).to_string());
    }
    (tr, oids)
}

#[test]
fn continue_operation_during_a_rebase_advances_the_plan() {
    let (tr, oids) = conflicting_plan_repo();
    let (backend, handle) = tr.open_with_backend();

    // Rewrite the first commit's content so replaying the second conflicts.
    let plan = vec![
        step(&oids[0], RebaseAction::Edit),
        step(&oids[1], RebaseAction::Pick),
    ];
    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert_eq!(status.pause_reason.as_deref(), Some("edit"));
    write_file(tr.path(), "shared.txt", "diverged\n");
    backend.stage(&handle.id, &[PathBuf::from("shared.txt")]).unwrap();

    let status = backend.rebase_continue(&handle.id).unwrap();
    assert_eq!(
        status.pause_reason.as_deref(),
        Some("conflict"),
        "replaying the second commit should conflict"
    );

    // The user resolves in the Conflict screen and presses its Continue, which
    // calls continue_operation — not rebase_continue.
    write_file(tr.path(), "shared.txt", "resolved\n");
    backend.stage(&handle.id, &[PathBuf::from("shared.txt")]).unwrap();
    backend.continue_operation(&handle.id).unwrap();

    let status = backend.rebase_status(&handle.id).unwrap();
    assert!(
        !status.in_progress,
        "the Conflict screen's Continue must advance the plan, not just commit"
    );
    assert!(!tr.repo.head_detached().unwrap(), "HEAD should be reattached");
    assert!(
        !tr.path().join(".git").join("platypusgit-rebase.json").exists(),
        "a completed rebase must leave no state file behind"
    );
    let _ = ResetMode::Hard; // keep the import honest if the helper is unused
}

#[test]
fn abort_operation_during_a_rebase_restores_the_branch() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let tip_before = branch_tip(&tr, "main");
    let (backend, handle) = tr.open_with_backend();

    backend
        .rebase_start(
            &handle.id,
            vec![
                step(&oids[0], RebaseAction::Pick),
                step(&oids[1], RebaseAction::Edit),
                step(&oids[2], RebaseAction::Pick),
            ],
        )
        .unwrap();

    backend.abort_operation(&handle.id).unwrap();

    assert_eq!(branch_tip(&tr, "main"), tip_before);
    assert!(!tr.repo.head_detached().unwrap());
    assert!(!backend.rebase_status(&handle.id).unwrap().in_progress);
    assert!(!tr.path().join(".git").join("platypusgit-rebase.json").exists());
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_durability
```

Expected: `continue_operation_during_a_rebase_advances_the_plan` fails — `continue_operation` commits the resolved tree and calls `cleanup_state`, leaving the rebase in progress with its conflict step still stashed.

- [ ] **Step 3: Delegate**

At the top of `continue_operation` in `src-tauri/src/git/libgit2.rs`:

```rust
    fn continue_operation(&self, repo_id: &RepoId) -> AppResult<String> {
        // The Conflict screen and the palette both land here. When the paused
        // operation is one of our rebases, committing the tree in isolation
        // would advance nothing and strand the rest of the plan — so hand it to
        // the engine that owns the plan.
        let rebasing = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.contains_key(repo_id)
        } || self.with_repo(repo_id, crate::git::rebase_state::load)?.is_some();

        if rebasing {
            self.rebase_continue(repo_id)?;
            return self.with_repo(repo_id, |repo| {
                Ok(repo.head()?.peel_to_commit()?.id().to_string())
            });
        }
        // … existing body, unchanged …
```

And at the top of `abort_operation`, replacing its in-memory-only special case:

```rust
    fn abort_operation(&self, repo_id: &RepoId) -> AppResult<()> {
        let rebasing = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.contains_key(repo_id)
        } || self.with_repo(repo_id, crate::git::rebase_state::load)?.is_some();

        if rebasing {
            // rebase_abort restores the branch and sweeps the state file; doing
            // it here as a plain hard reset would leave both to guesswork.
            return self.rebase_abort(repo_id);
        }
        // … existing body: cleanup_state + hard reset to HEAD …
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: the whole backend suite passes, including `abort_operation_clears_rebase_state_and_restores_pre_rebase_head` in `rebase.rs`, which now exercises the delegation path.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/libgit2.rs src-tauri/tests/rebase_durability.rs
git commit -m "fix(rebase): route the Conflict screen's Continue through the engine

Why: continue_operation committed the resolved tree and cleaned up state
without advancing the plan, so resolving a paused pick from the Conflict
screen instead of the Rebase banner silently stranded the rest of the
rebase. Both entry points now drive one engine."
```

---

### Task 5: Derive the base from the commit's parent, not the next log row

**Files:**
- Modify: `src/features/commits/planCommitSelection.ts`
- Create: `src/features/commits/planCommitSelection.merge.test.ts`
- Modify: `src/design/context-menu.tsx` (`commitMenuItems`)

**Interfaces:**
- Produces: `planCommitSelection` with `baseOid` = oldest selected commit's `parents[0]` and `contiguous` = "the selection is a first-parent chain"; `commitMenuItems` reads its base through `planCommitSelection(commits, [sha])`.

- [ ] **Step 1: Write the failing test**

Create `src/features/commits/planCommitSelection.merge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planCommitSelection } from "./planCommitSelection";
import type { CommitInfo } from "@/lib/types";

/**
 * Newest-first log of
 *
 *   root ── A ──── C ── M   (main)
 *            \        /
 *             ─── F ──      (feature)
 *
 * The row after `C` is `F` — a side-branch commit, not C's parent. That is the
 * shape the positional `commits[max + 1]` base guess got wrong.
 */
function graphLog(): CommitInfo[] {
  const mk = (oid: string, summary: string, parents: string[]): CommitInfo => ({
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Test",
    email: "t@e.com",
    timestamp: 0,
    parents,
    refs: [],
  });
  return [
    mk("m".repeat(40), "Merge branch 'feature'", ["c".repeat(40), "f".repeat(40)]),
    mk("c".repeat(40), "C on main", ["a".repeat(40)]),
    mk("f".repeat(40), "F on feature", ["a".repeat(40)]),
    mk("a".repeat(40), "A on main", ["r".repeat(40)]),
    mk("r".repeat(40), "root", []),
  ];
}

describe("planCommitSelection on non-linear history", () => {
  it("takes the base from the commit's first parent, not the next log row", () => {
    const plan = planCommitSelection(graphLog(), ["c".repeat(40)]);
    expect(plan?.baseOid).toBe("a".repeat(40));
  });

  it("reports a merge commit's base as its mainline parent", () => {
    const plan = planCommitSelection(graphLog(), ["m".repeat(40)]);
    expect(plan?.baseOid).toBe("c".repeat(40));
    expect(plan?.hasMerge).toBe(true);
  });

  it("null base for a root commit", () => {
    const plan = planCommitSelection(graphLog(), ["r".repeat(40)]);
    expect(plan?.baseOid).toBeNull();
  });

  it("adjacent log rows on different branches are not contiguous", () => {
    // C and F sit next to each other in the log but neither is the other's
    // parent, so they do not form a squashable run.
    const plan = planCommitSelection(graphLog(), ["c".repeat(40), "f".repeat(40)]);
    expect(plan?.contiguous).toBe(false);
  });

  it("a real first-parent chain is contiguous", () => {
    const plan = planCommitSelection(graphLog(), ["c".repeat(40), "a".repeat(40)]);
    expect(plan?.contiguous).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/planCommitSelection.merge.test.ts
```

Expected: the base tests fail (`baseOid` is `"fff…"` — the next log row) and `adjacent log rows on different branches are not contiguous` fails (positional adjacency reports `true`).

- [ ] **Step 3: Fix the derivation**

In `src/features/commits/planCommitSelection.ts`, replace the `baseOid` and `contiguous` computation in the returned object:

```ts
  const oldest = commits[max];

  // The base is the oldest selected commit's FIRST PARENT, looked up by oid.
  // It used to be `commits[max + 1]` — the next row in a graph-ordered log,
  // which on any non-linear history is frequently a side-branch commit rather
  // than a parent, so the rebase reset to the wrong place and silently dropped
  // whatever sat between.
  const baseOid = oldest.parents[0] ?? null;

  // Contiguity means "these commits form an unbroken first-parent chain",
  // which is what a range squash replays. Adjacent log rows are not enough:
  // C and F can be neighbours while belonging to different branches.
  const oldestFirst = indices
    .slice()
    .sort((a, b) => b - a)
    .map((i) => commits[i]);
  const contiguous = oldestFirst.every((c, i) => {
    if (i === 0) return true;
    return oldestFirst[i].parents[0] === oldestFirst[i - 1].oid;
  });

  return {
    oids,
    oldestOid: oldest.oid,
    newestOid: commits[min].oid,
    baseOid,
    contiguous,
    hasMerge: indices.some((i) => commits[i].parents.length > 1),
  };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/planCommitSelection
```

Expected: the new file passes and the existing `planCommitSelection` tests still pass. If an existing test asserted a positional base on a linear log, it keeps passing — on a linear log the next row *is* the first parent.

- [ ] **Step 5: Route the single-commit entry points through it**

In `src/design/context-menu.tsx`, `commitMenuItems` currently computes `const base = commits[idx + 1]?.oid` three times. Replace each with the shared derivation, and make the merge cases explicit. At the top of `commitMenuItems`, after `const commits = …` is available inside the handlers, add a helper above the returned array:

```tsx
  const commits = useRepoStore.getState().commits;
  const self = commit?.sha ? commits.find((c) => c.oid === commit.sha) ?? null : null;
  const isMerge = (self?.parents.length ?? 0) > 1;
  // Base for "everything after this commit" — its first parent. Never the next
  // log row: on a graph that row is often a side branch (see
  // planCommitSelection).
  const baseOid = self?.parents[0] ?? null;
```

Then in the three handlers use `baseOid` instead of `commits[idx + 1]?.oid`, and gate the two folding actions on `isMerge`, following the disabled-label pattern `commitMultiMenuItems` already uses:

```tsx
    {
      icon: "rebase",
      label: "Interactive rebase from here",
      disabled: !baseOid,
      onClick: () => {
        if (!commit?.sha || !baseOid) return;
        const plan = buildRebasePlan(commits, baseOid, { kind: "edit-from" });
        if (!plan || plan.length === 0) return;
        useNavStore.getState().setIntent({ kind: "rebase-plan", plan });
      },
    },
```

```tsx
    {
      icon: "fix",
      label: isMerge
        ? "Fixup into parent — merge commit"
        : "Fixup this commit into its parent",
      disabled: isMerge || !baseOid,
      onClick: () => { /* unchanged body, using baseOid */ },
    },
```

```tsx
    {
      icon: "squash",
      label: isMerge
        ? "Squash into parent — merge commit"
        : "Squash this commit into its parent",
      disabled: isMerge || !baseOid,
      onClick: async () => { /* unchanged body, using baseOid */ },
    },
```

Note: `commitMenuItems` takes `{ sha?, subject? }`, so the full `CommitInfo` comes from the store lookup — the same lookup the handlers already do.

- [ ] **Step 6: Verify**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm test
```

Expected: typecheck clean, whole frontend suite green.

- [ ] **Step 7: Commit**

```bash
git add src/features/commits/planCommitSelection.ts \
        src/features/commits/planCommitSelection.merge.test.ts \
        src/design/context-menu.tsx
git commit -m "fix(rebase): take the rebase base from the commit's parent

Why: the base came from commits[idx + 1] — the next row in a
graph-ordered log. On non-linear history that row is often a
side-branch commit, so the rebase reset to the wrong base and dropped
whatever sat between it and the plan's first step. Squash/fixup on a
merge commit is now disabled with the reason in the label."
```

---

### Task 6: Whole-suite gate and CLAUDE.md note

**Files:**
- Modify: `CLAUDE.md` (architecture section, backend file list)

- [ ] **Step 1: Run every layer**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
pnpm test
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts --spec e2e/specs/merge-conflict.e2e.ts
```

Expected: all green. The two e2e specs are the ones that touch the rebase engine and the conflict Continue/Abort path this PR rewired.

- [ ] **Step 2: Document the two new modules**

In `CLAUDE.md`, under `### Backend (src-tauri/src/)`, add to the `git/` listing beside `ownership.rs`:

```
├── rebase_plan.rs  Plan validation before execution — merge-legal actions,
│                duplicate/unknown oids, all-drop plans. Runs BEFORE
│                rebase_start touches the repo (a rejected plan must leave
│                HEAD, the branch, and the worktree untouched)
├── rebase_state.rs  On-disk mirror of an in-progress rebase
│                (.git/platypusgit-rebase.json + ORIG_HEAD) so Abort survives
│                an app restart. Deliberately NOT git's .git/rebase-merge/
```

And add a line to the "State management" or a new note under Conventions:

```markdown
- **The rebase engine replays on a detached HEAD** and moves the branch ref
  exactly once, when the plan completes — so a failed or paused rebase never
  leaves the branch mid-replay. `continue_operation` / `abort_operation`
  delegate to `rebase_continue` / `rebase_abort` whenever
  `.git/platypusgit-rebase.json` exists; the Conflict screen and the Rebase
  banner must stay two entry points to one engine.
```

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md
git commit -m "docs: note the rebase engine's execution model and state file"
git push -u origin HEAD
gh pr create --title "fix(rebase): stop a merge commit from half-rewriting the branch" --body "$(cat <<'EOF'
## What

PR1 of three from `docs/superpowers/specs/2026-08-14-rebase-merge-commits-design.md`.

A rebase plan containing a merge commit used to fail with libgit2's
"mainline branch is not specified" error on the step that reached it —
after earlier picks had been committed and the branch tip moved, with
abort-ability held only in memory.

- Plans are validated before the repository is touched (`git/rebase_plan.rs`,
  new `AppError::InvalidRebasePlan`). A merge commit may be dropped
  (git's own flattening default); any other action on it is refused up front.
- The replay runs on a detached HEAD; the branch ref moves once, on completion.
- `.git/platypusgit-rebase.json` + `ORIG_HEAD` mirror the operation, so a
  restarted app still reports the rebase and can continue or abort it (the plan,
  progress, and rewritten map are rehydrated from the file). `repo_state`
  reports `RebaseInteractive` while it exists.
- The Conflict screen's Continue/Abort delegate to the rebase engine instead of
  committing the tree and stranding the plan.
- The rebase base comes from the commit's first parent, not the next log row.

## Testing

`cargo test` (new: `rebase_validation.rs`, `rebase_durability.rs`), `pnpm test`
(new: `planCommitSelection.merge.test.ts`), `pnpm tsc --noEmit`, and
`pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts --spec e2e/specs/merge-conflict.e2e.ts`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
