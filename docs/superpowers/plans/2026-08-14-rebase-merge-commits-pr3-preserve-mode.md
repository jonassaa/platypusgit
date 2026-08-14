# Interactive rebase over merge commits — PR3: preserve mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive rebase can keep the branch topology: merge commits are recreated by re-merging their rewritten parents, the equivalent of `git rebase --rebase-merges`, opt-in behind a mode toggle that states its costs.

**Architecture:** git needs `label` / `reset` / `merge <label>` because its todo list is a text file a human edits. This plan is generated, so topology is encoded structurally: every step may name the original commit it must be applied `onto`, and the engine resolves that through the `rewritten` map PR1 already records — every commit is implicitly its own label. A merge step additionally carries its parents beyond the first, and the engine re-merges them in the worktree, which means a conflicting recreated merge pauses through the same machinery (and the same merge resolver window) as a conflicting pick.

**Tech Stack:** Rust + git2 0.20.4 (`Repository::merge`, `find_annotated_commit`), React + Zustand, vitest/RTL, WebdriverIO (Docker only), `cargo test`.

**Spec:** `docs/superpowers/specs/2026-08-14-rebase-merge-commits-design.md`

**Depends on:** PR1 (detached-HEAD model, `rewritten` map, `rebase_plan::validate`, durable state) and PR2 (`MainlinePick`, merge-aware plan rows, `PGRebaseRow` options/badge).

## Global Constraints

- Every IPC-crossing fn returns `AppResult<T>`; no `unwrap`/`panic` in commands.
- New Rust fields that cross IPC update `src/lib/types.ts` **in the same commit**. Wire format is camelCase (`mergeParents`).
- New Rust struct fields carry `#[serde(default)]` so a plan built by older frontend code still deserialises.
- `rebase_plan::merge_legal` stays the single source of truth for which actions a merge accepts; `MERGE_ACTIONS` in `src/screens/Rebase.tsx` mirrors it.
- Frontend never calls `invoke()` directly.
- Never call `window.confirm` / `window.prompt` — `pgConfirm` / `pgPrompt` from `@/design`.
- Any new list-row surface opts into UI density via `--row-step`.
- E2E only through Docker: `pnpm test:e2e:docker build` then `pnpm test:e2e:docker run --spec …`. Read `.claude/skills/e2e-testing/SKILL.md` first.
- Run cargo/pnpm with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- Reordering is **not** offered in preserve mode. git documents its own reorder bugs under `--rebase-merges`; a reorder that silently produces the wrong topology is worse than no reorder.

## File Structure

**Create:**
- `src-tauri/tests/rebase_preserve.rs` — `onto` resets, clean recreate, conflicting recreate, octopus rejection.
- `src/features/commits/buildPreservePlan.ts` — the topology-aware plan builder.
- `src/features/commits/buildPreservePlan.test.ts` — its tests.
- `src/features/rebase/useRebaseMergeMode.ts` — persisted flatten ⇄ preserve preference.
- `src/screens/Rebase.preserve.test.tsx` — mode toggle, preserve warning, reorder lock.

**Modify:**
- `src-tauri/src/git/types.rs` — `RebaseStep.onto`, `RebaseStep.merge_parents`, `RebaseAction::Merge`.
- `src-tauri/src/git/rebase_plan.rs` — `merge_legal` widened; `onto` and merge-parent validation.
- `src-tauri/src/git/libgit2.rs` — base resolution per step, `apply_merge`, `finish_merge`, `rebase_start` base from `onto`.
- `src/lib/types.ts` — `RebaseStep` fields, `RebaseAction` member.
- `src/screens/Rebase.tsx` — mode toggle, preserve plan, warning copy, reorder lock.
- `e2e/specs/rebase.e2e.ts` — a preserve run.
- `CLAUDE.md` — the preserve contract.

---

### Task 1: `onto` — a step declares the commit it applies onto

**Files:**
- Modify: `src-tauri/src/git/types.rs`
- Modify: `src/lib/types.ts`
- Modify: `src-tauri/src/git/rebase_plan.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Create: `src-tauri/tests/rebase_preserve.rs`

**Interfaces:**
- Consumes: `RebaseState.rewritten` and `record_rewritten` (PR1 Task 2).
- Produces: `RebaseStep { oid, action, message, onto: Option<String>, merge_parents: Vec<String> }` (Rust) / `{ oid, action, message, onto?, mergeParents? }` (TS); `Libgit2Backend::move_to_base(&self, repo_id: &RepoId, original_oid: &str) -> AppResult<()>`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/rebase_preserve.rs`:

```rust
//! Topology-aware replay. A step may name the original commit it must be
//! applied onto; the engine resolves that through the rewritten map and resets
//! the detached HEAD there first. That is what lets a side branch be replayed
//! at its own branch point instead of being flattened onto the mainline.

mod support;

use platypusgit_lib::{
    error::AppError,
    git::{
        types::{RebaseAction, RebaseStep},
        GitBackend,
    },
};

use support::{merge_history, TempRepo};

fn pick(oid: &str) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action: RebaseAction::Pick,
        message: None,
        onto: None,
        merge_parents: Vec::new(),
    }
}

fn pick_onto(oid: &str, onto: &str) -> RebaseStep {
    RebaseStep { onto: Some(onto.to_string()), ..pick(oid) }
}

#[test]
fn onto_replays_a_step_at_its_own_branch_point() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    // A, then F on top of A, then C back on top of A — a fork, no merge yet.
    // Without `onto`, C would land on top of F (the previous step's result).
    let status = backend
        .rebase_start(
            &handle.id,
            vec![pick(&h.a), pick(&h.f), pick_onto(&h.c, &h.a)],
        )
        .unwrap();
    assert!(!status.in_progress);

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.summary().unwrap(), "C on main");
    assert_eq!(
        head.parent(0).unwrap().summary().unwrap(),
        "A on main",
        "C must sit on the rewritten A, not on F"
    );
    // F is not an ancestor of the new HEAD — it was replayed on a fork that the
    // final HEAD does not descend from.
    assert!(!tr.path().join("f.txt").exists(), "F's fork is not checked out at HEAD");
}

#[test]
fn onto_naming_an_unknown_commit_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let tip_before = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    let err = backend
        .rebase_start(
            &handle.id,
            vec![pick_onto(&h.a, "0000000000000000000000000000000000000000")],
        )
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
    assert_eq!(
        tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string(),
        tip_before,
        "a rejected plan must not move anything"
    );
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_preserve
```

Expected: compile error — `RebaseStep` has no `onto` / `merge_parents`.

- [ ] **Step 3: Extend the step type (Rust + TS)**

In `src-tauri/src/git/types.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    /// Commit to operate on (full OID from the log).
    pub oid: String,
    pub action: RebaseAction,
    /// New message for reword / squash. Ignored for other actions.
    pub message: Option<String>,
    /// The **original** oid this step must be applied onto. The engine resolves
    /// it through the rewritten map and resets the detached HEAD there before
    /// applying. `None` means "onto whatever the previous step produced", the
    /// linear default. This is how topology is expressed without git's
    /// label/reset todo language: every commit is implicitly its own label.
    #[serde(default)]
    pub onto: Option<String>,
    /// A merge step's **original** parents beyond the first, resolved through
    /// the rewritten map at merge time. Empty for every other action.
    #[serde(default)]
    pub merge_parents: Vec<String>,
}
```

In `src/lib/types.ts`:

```ts
export interface RebaseStep {
  oid: string;
  action: RebaseAction;
  message: string | null;
  /** Original oid this step applies onto; omitted = onto the previous step. */
  onto?: string | null;
  /** A merge step's original parents beyond the first. */
  mergeParents?: string[];
}
```

Existing Rust constructions of `RebaseStep` (tests in `rebase.rs`, `rebase_validation.rs`, `rebase_flatten.rs`, `rebase_durability.rs`) need the two new fields. Update their local `step` / `step_msg` helpers once each:

```rust
fn step(oid: &str, action: RebaseAction) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action,
        message: None,
        onto: None,
        merge_parents: Vec::new(),
    }
}
```

- [ ] **Step 4: Validate `onto`**

In `src-tauri/src/git/rebase_plan.rs`, inside `validate`'s loop over steps, after the merge-action check, add:

```rust
        if let Some(onto) = &step.onto {
            let known_earlier = plan
                .iter()
                .take_while(|s| s.oid != step.oid)
                .any(|s| &s.oid == onto);
            let exists = repo
                .revparse_single(onto)
                .and_then(|o| o.peel_to_commit())
                .is_ok();
            if !known_earlier && !exists {
                return Err(AppError::InvalidRebasePlan(format!(
                    "{} is applied onto {}, which is neither an earlier step nor \
                     an existing commit",
                    short(&step.oid),
                    short(onto)
                )));
            }
        }
```

- [ ] **Step 5: Resolve the base before applying each step**

In `src-tauri/src/git/libgit2.rs`, add a helper beside `record_rewritten`:

```rust
    /// Put the detached HEAD on the commit a step wants to be applied onto.
    /// `original_oid` is the pre-rebase oid; the rewritten map translates it to
    /// this run's copy, falling back to the original when the commit was not
    /// rewritten (it sits below the range).
    fn move_to_base(&self, repo_id: &RepoId, original_oid: &str) -> AppResult<()> {
        let resolved = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases
                .get(repo_id)
                .and_then(|s| s.rewritten.get(original_oid).cloned())
                .unwrap_or_else(|| original_oid.to_string())
        };

        self.with_repo(repo_id, |repo| {
            let target = repo
                .revparse_single(&resolved)
                .map_err(|_| AppError::InvalidRef(resolved.clone()))?
                .peel_to_commit()?;
            if repo.head()?.peel_to_commit()?.id() == target.id() {
                return Ok(()); // already there — nothing to reset
            }
            repo.set_head_detached(target.id())?;
            repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
            Ok(())
        })
    }
```

In `advance_rebase`, immediately after the step is taken and the `Drop` fast-path, before the mainline computation:

```rust
            // Topology: a step that names an `onto` is replayed there rather
            // than on the previous step's result. Skipped while resuming — the
            // worktree already holds the user's resolution for this step.
            if !resuming {
                if let Some(onto) = step.onto.clone() {
                    self.move_to_base(repo_id, &onto)?;
                }
            }
```

Note the ordering constraint: the `Drop` fast-path `continue`s before this, and `record_rewritten` maps a dropped commit to the HEAD it left behind, so a later step whose `onto` is that dropped commit still resolves to a real commit.

`rebase_start` picks the base for the whole run from the first step's `onto` when it has one, falling back to its first parent:

```rust
            let base = match &first_step_onto {
                Some(onto) => repo
                    .revparse_single(onto)
                    .map_err(|_| AppError::InvalidRef(onto.clone()))?
                    .peel_to_commit()?,
                None => {
                    let first_commit = repo
                        .revparse_single(&first_oid_str)
                        .map_err(|_| AppError::InvalidRef(first_oid_str.clone()))?
                        .peel_to_commit()?;
                    first_commit.parent(0).map_err(|_| {
                        AppError::InvalidRebasePlan(format!(
                            "{} has no parent to rebase onto",
                            crate::git::rebase_plan::short(&first_oid_str)
                        ))
                    })?
                }
            };
            repo.set_head_detached(base.id())?;
            repo.reset(base.as_object(), git2::ResetType::Hard, None)?;
```

where `first_step_onto` is captured next to `first_oid_str` above the closure:

```rust
        let first_step_onto = first_step.onto.clone();
```

- [ ] **Step 6: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_preserve
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
```

Expected: both new tests pass and every earlier rebase test still passes (all of them leave `onto: None`, which is the old linear behaviour).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git/types.rs src-tauri/src/git/rebase_plan.rs src-tauri/src/git/libgit2.rs \
        src-tauri/tests/rebase_preserve.rs src-tauri/tests/rebase.rs \
        src-tauri/tests/rebase_validation.rs src-tauri/tests/rebase_flatten.rs \
        src-tauri/tests/rebase_durability.rs src/lib/types.ts
git commit -m "feat(rebase): let a step declare the commit it is applied onto

Why: recreating a merge means replaying a side branch at its own branch
point, which a strictly linear loop cannot express. git needs
label/reset for this because its todo list is hand-edited text; a
generated plan can just name the original commit and let the engine
resolve it through the rewritten map."
```

---

### Task 2: `Merge` — recreate a merge from its rewritten parents

**Files:**
- Modify: `src-tauri/src/git/types.rs`
- Modify: `src/lib/types.ts`
- Modify: `src-tauri/src/git/rebase_plan.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/tests/rebase_preserve.rs`

**Interfaces:**
- Consumes: `move_to_base`, `RebaseStep.merge_parents` (Task 1).
- Produces: `RebaseAction::Merge`; `Libgit2Backend::apply_merge(&self, repo_id: &RepoId, step: &RebaseStep) -> AppResult<bool>` (false = conflicts, paused); `Libgit2Backend::finish_merge(&self, repo_id: &RepoId, step: &RebaseStep) -> AppResult<()>`.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/rebase_preserve.rs`:

```rust
fn merge_step(oid: &str, onto: &str, parents: &[&str]) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action: RebaseAction::Merge,
        message: None,
        onto: Some(onto.to_string()),
        merge_parents: parents.iter().map(|s| s.to_string()).collect(),
    }
}

#[test]
fn a_merge_is_recreated_from_its_rewritten_parents() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    // The topology-preserving plan for root..M:
    //   A, then F (on A), then C (back onto A), then M merging F into C.
    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                pick(&h.a),
                pick(&h.f),
                pick_onto(&h.c, &h.a),
                merge_step(&h.m, &h.c, &[&h.f]),
            ],
        )
        .unwrap();
    assert!(!status.in_progress, "a clean recreate should not pause");

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.parent_count(), 2, "the merge must be recreated as a merge");
    assert_eq!(head.summary().unwrap(), "Merge branch 'feature'");
    assert_ne!(
        head.id().to_string(),
        h.m,
        "the recreated merge is a new commit, not the original"
    );

    let first = head.parent(0).unwrap();
    let second = head.parent(1).unwrap();
    assert_eq!(first.summary().unwrap(), "C on main");
    assert_eq!(second.summary().unwrap(), "F on feature");
    assert_ne!(first.id().to_string(), h.c, "parents must be the rewritten copies");
    assert_ne!(second.id().to_string(), h.f, "parents must be the rewritten copies");

    // Both sides' content is present, and the worktree is clean.
    assert!(tr.path().join("f.txt").exists());
    assert!(tr.path().join("c.txt").exists());
    assert!(tr.repo.statuses(None).unwrap().is_empty());
}

#[test]
fn merge_on_a_non_merge_commit_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .rebase_start(&handle.id, vec![merge_step(&h.c, &h.a, &[&h.f])])
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
}

#[test]
fn merge_without_parents_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .rebase_start(&handle.id, vec![pick(&h.a), merge_step(&h.m, &h.c, &[])])
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
}

#[test]
fn an_octopus_merge_cannot_be_recreated_but_can_be_flattened() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);

    // Build a third parent and an octopus merge on top of M.
    let extra = {
        support::fs::write_file(tr.path(), "x.txt", "x\n");
        tr.commit_all("X on main").to_string()
    };
    let octopus = {
        let sig = git2::Signature::now("Test", "t@e.com").unwrap();
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let f = tr.repo.find_commit(git2::Oid::from_str(&h.f).unwrap()).unwrap();
        let m = tr.repo.find_commit(git2::Oid::from_str(&h.m).unwrap()).unwrap();
        let tree = head.tree().unwrap();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, "octopus", &tree, &[&head, &f, &m])
            .unwrap()
            .to_string()
    };
    let _ = extra;

    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .rebase_start(
            &handle.id,
            vec![merge_step(&octopus, &h.m, &[&h.f, &h.m])],
        )
        .unwrap_err();
    match err {
        AppError::InvalidRebasePlan(msg) => {
            assert!(msg.contains("octopus"), "message should name the shape: {msg}");
        }
        other => panic!("expected InvalidRebasePlan, got {other:?}"),
    }

    // Dropping it is still allowed.
    let plan = vec![RebaseStep {
        oid: octopus.clone(),
        action: RebaseAction::Drop,
        message: None,
        onto: None,
        merge_parents: Vec::new(),
    }];
    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    assert!(
        matches!(err, AppError::InvalidRebasePlan(ref m) if m.contains("drops every commit")),
        "a drop-only plan is refused for that reason, not for being an octopus: {err:?}"
    );
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_preserve
```

Expected: compile error — `RebaseAction::Merge` does not exist.

- [ ] **Step 3: Add the action and widen validation**

`src-tauri/src/git/types.rs`:

```rust
    /// Recreate a merge commit: re-merge its rewritten parents and commit the
    /// result with the original message and parent count
    /// (`git rebase --rebase-merges`). Conflict resolutions recorded in the
    /// original merge are NOT reused — git does not either.
    Merge,
```

`src/lib/types.ts`: add `| "Merge"` to the `RebaseAction` union.

`src-tauri/src/git/rebase_plan.rs` — widen `merge_legal` and add the `Merge`-specific checks inside `validate`'s loop:

```rust
pub fn merge_legal(action: RebaseAction) -> bool {
    matches!(
        action,
        RebaseAction::Drop | RebaseAction::MainlinePick | RebaseAction::Merge
    )
}
```

```rust
        if step.action == RebaseAction::Merge {
            if commit.parent_count() < 2 {
                return Err(AppError::InvalidRebasePlan(format!(
                    "{} is not a merge commit, so it cannot be recreated as one",
                    short(&step.oid)
                )));
            }
            if commit.parent_count() > 2 {
                return Err(AppError::InvalidRebasePlan(format!(
                    "{} is an octopus merge ({} parents) — recreating one is not \
                     supported yet; drop it or keep it as one commit",
                    short(&step.oid),
                    commit.parent_count()
                )));
            }
            if step.merge_parents.is_empty() {
                return Err(AppError::InvalidRebasePlan(format!(
                    "{} is a merge step with no parents to merge",
                    short(&step.oid)
                )));
            }
        } else if !step.merge_parents.is_empty() {
            return Err(AppError::InvalidRebasePlan(format!(
                "{} carries merge parents but its action is {:?}",
                short(&step.oid),
                step.action
            )));
        }
```

- [ ] **Step 4: Implement the merge step**

In `src-tauri/src/git/libgit2.rs`, add two helpers next to `finish_pick`:

```rust
    /// Resolve a step's original parents through the rewritten map.
    fn resolved_merge_parents(
        &self,
        repo_id: &RepoId,
        step: &RebaseStep,
    ) -> AppResult<Vec<String>> {
        let rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let rewritten = rebases.get(repo_id).map(|s| &s.rewritten);
        Ok(step
            .merge_parents
            .iter()
            .map(|old| {
                rewritten
                    .and_then(|m| m.get(old).cloned())
                    .unwrap_or_else(|| old.clone())
            })
            .collect())
    }

    /// Re-merge a recreated merge's other parents into the current HEAD.
    /// Returns `Ok(false)` when the merge conflicts — the worktree keeps the
    /// conflicted index so the Conflict screen and the merge resolver window
    /// work exactly as they do for a conflicting pick.
    fn apply_merge(&self, repo_id: &RepoId, step: &RebaseStep) -> AppResult<bool> {
        let parents = self.resolved_merge_parents(repo_id, step)?;
        self.with_repo(repo_id, |repo| {
            let annotated: Vec<git2::AnnotatedCommit> = parents
                .iter()
                .map(|oid| {
                    let commit = repo
                        .revparse_single(oid)
                        .map_err(|_| AppError::InvalidRef(oid.clone()))?
                        .peel_to_commit()?;
                    Ok(repo.find_annotated_commit(commit.id())?)
                })
                .collect::<AppResult<Vec<_>>>()?;
            let refs: Vec<&git2::AnnotatedCommit> = annotated.iter().collect();
            // A worktree merge, not merge_commits: the conflicted index with its
            // stages is what every conflict surface in the app reads.
            repo.merge(&refs, None, None)?;
            let index = repo.index()?;
            Ok(!index.has_conflicts())
        })
    }

    /// Commit the staged tree as the recreated merge — original message and
    /// author, parents = current HEAD plus the rewritten other parents.
    fn finish_merge(&self, repo_id: &RepoId, step: &RebaseStep) -> AppResult<()> {
        let parents = self.resolved_merge_parents(repo_id, step)?;
        self.with_repo(repo_id, |repo| {
            let original = repo
                .revparse_single(&step.oid)
                .map_err(|_| AppError::InvalidRef(step.oid.clone()))?
                .peel_to_commit()?;
            let sig = crate::git::signature::default_signature(repo)?;
            let mut index = repo.index()?;
            let tree = repo.find_tree(index.write_tree()?)?;
            let head = repo.head()?.peel_to_commit()?;

            let others: Vec<git2::Commit> = parents
                .iter()
                .map(|oid| {
                    Ok(repo
                        .revparse_single(oid)
                        .map_err(|_| AppError::InvalidRef(oid.clone()))?
                        .peel_to_commit()?)
                })
                .collect::<AppResult<Vec<_>>>()?;
            let mut parent_refs: Vec<&git2::Commit> = vec![&head];
            parent_refs.extend(others.iter());

            repo.commit(
                Some("HEAD"),
                &original.author(),
                &sig,
                original.message().unwrap_or(""),
                &tree,
                &parent_refs,
            )?;
            repo.cleanup_state()?;
            Ok(())
        })
    }
```

In `advance_rebase`, branch on the action before the cherry-pick path. Insert right after the `move_to_base` block from Task 1:

```rust
            if step.action == RebaseAction::Merge {
                if !resuming && !self.apply_merge(repo_id, &step)? {
                    let mut rebases = self
                        .rebases
                        .lock()
                        .map_err(|e| AppError::Internal(e.to_string()))?;
                    if let Some(state) = rebases.get_mut(repo_id) {
                        state.conflict_step = Some(step);
                    }
                    drop(rebases);
                    return self.mark_paused(repo_id, "conflict");
                }
                self.finish_merge(repo_id, &step)?;
                self.record_rewritten(repo_id, &step.oid)?;
                self.bump_completed(repo_id)?;
                self.persist_rebase(repo_id)?;
                continue;
            }
```

`RebaseState.conflict_step` already round-trips the whole step, so a resumed merge takes the `resuming` path and lands in `finish_merge` — which is why the branch above checks `resuming` only around `apply_merge`.

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_preserve
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
```

Expected: all four new tests pass, whole backend suite green.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/types.rs src-tauri/src/git/rebase_plan.rs src-tauri/src/git/libgit2.rs \
        src-tauri/tests/rebase_preserve.rs src/lib/types.ts
git commit -m "feat(rebase): recreate merge commits from their rewritten parents

Why: flattening is the right default but destroys deliberate branch
structure. A Merge step re-merges the rewritten parents in the worktree
and commits with the original message and parent count — the equivalent
of git rebase --rebase-merges. Octopus merges are refused explicitly
rather than mis-recreated."
```

---

### Task 3: A conflicting recreated merge pauses and resumes

**Files:**
- Modify: `src-tauri/tests/rebase_preserve.rs`
- Modify: `src-tauri/src/git/libgit2.rs` (only if the test exposes a gap)

**Interfaces:**
- Consumes: `apply_merge` / `finish_merge` (Task 2), `conflict_sides` (existing).

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/rebase_preserve.rs`:

```rust
use std::path::PathBuf;
use support::fs::write_file;

/// Same shape as `merge_history`, but both sides edit `shared.txt`, so the
/// recreated merge conflicts.
fn conflicting_merge_history(tr: &TempRepo) -> (String, String, String, String) {
    write_file(tr.path(), "shared.txt", "base\n");
    let a = tr.commit_all("A on main").to_string();

    let a_commit = tr.repo.find_commit(git2::Oid::from_str(&a).unwrap()).unwrap();
    tr.repo.branch("feature", &a_commit, false).unwrap();
    tr.repo.set_head("refs/heads/feature").unwrap();
    tr.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    write_file(tr.path(), "shared.txt", "feature\n");
    let f = tr.commit_all("F on feature").to_string();

    tr.repo.set_head("refs/heads/main").unwrap();
    tr.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    write_file(tr.path(), "shared.txt", "main\n");
    let c = tr.commit_all("C on main").to_string();

    // Resolve the original merge one way — the recreate must NOT reuse it.
    let f_oid = git2::Oid::from_str(&f).unwrap();
    let annotated = tr.repo.find_annotated_commit(f_oid).unwrap();
    tr.repo.merge(&[&annotated], None, None).unwrap();
    write_file(tr.path(), "shared.txt", "original resolution\n");
    let mut index = tr.repo.index().unwrap();
    index.add_path(std::path::Path::new("shared.txt")).unwrap();
    index.write().unwrap();
    let tree = tr.repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("Test", "t@e.com").unwrap();
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
    (a, f, c, m)
}

#[test]
fn a_conflicting_recreated_merge_pauses_and_resumes() {
    let tr = TempRepo::with_initial_commit("root\n");
    let (a, f, c, m) = conflicting_merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                pick(&a),
                pick(&f),
                pick_onto(&c, &a),
                merge_step(&m, &c, &[&f]),
            ],
        )
        .unwrap();
    assert!(status.in_progress, "the recreated merge should conflict");
    assert_eq!(status.pause_reason.as_deref(), Some("conflict"));

    // The conflict is visible through the same API the Conflict screen and the
    // merge resolver window use.
    let sides = backend
        .conflict_sides(&handle.id, std::path::Path::new("shared.txt"))
        .unwrap();
    assert!(sides.ours.is_some(), "ours side missing: {sides:?}");
    assert!(sides.theirs.is_some(), "theirs side missing: {sides:?}");

    // Resolve and continue.
    write_file(tr.path(), "shared.txt", "resolved by hand\n");
    backend.stage(&handle.id, &[PathBuf::from("shared.txt")]).unwrap();
    let done = backend.rebase_continue(&handle.id).unwrap();
    assert!(!done.in_progress, "continue should finish the plan");

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.parent_count(), 2, "the resumed step must still be a merge");
    assert_eq!(head.summary().unwrap(), "Merge branch 'feature'");
    assert_eq!(
        std::fs::read_to_string(tr.path().join("shared.txt")).unwrap(),
        "resolved by hand\n",
        "the user's resolution is what gets committed"
    );
    assert!(!tr.repo.head_detached().unwrap(), "HEAD reattached on completion");
}
```

- [ ] **Step 2: Run it**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_preserve
```

Expected: this should pass on Task 2's implementation. If it fails, the two likely causes and their fixes:

- **`conflict_sides` finds no stages** — `repo.merge` was given checkout options that skipped writing the conflicted index. Pass `None` for both options (as Task 2 does) and confirm `repo.index()?.has_conflicts()` is true at the pause.
- **The resumed step commits one parent** — the `resuming` branch fell through to `finish_pick` instead of `finish_merge`. The `if step.action == RebaseAction::Merge` branch must be evaluated for resumed steps too; only the `apply_merge` call inside it is guarded by `!resuming`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tests/rebase_preserve.rs src-tauri/src/git/libgit2.rs
git commit -m "test(rebase): a conflicting recreated merge pauses and resumes

Covers the whole path: the pause exposes stages through conflict_sides
(so the Conflict screen and the merge resolver window work unchanged),
and continuing commits the user's resolution as a two-parent merge."
```

---

### Task 4: The preserve-mode toggle

**Files:**
- Create: `src/features/commits/buildPreservePlan.ts`
- Create: `src/features/commits/buildPreservePlan.test.ts`
- Create: `src/features/rebase/useRebaseMergeMode.ts`
- Modify: `src/screens/Rebase.tsx`
- Create: `src/screens/Rebase.preserve.test.tsx`

**Interfaces:**
- Produces: `buildPreservePlan(range: CommitInfo[]): RebaseStep[]` (range is newest-first, as the log returns it); `useRebaseMergeMode(): [RebaseMergeMode, (m: RebaseMergeMode) => void]` with `type RebaseMergeMode = "flatten" | "preserve"`.

- [ ] **Step 1: Write the failing test for the plan builder**

Create `src/features/commits/buildPreservePlan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPreservePlan } from "./buildPreservePlan";
import type { CommitInfo } from "@/lib/types";

function mk(oid: string, summary: string, parents: string[]): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Test",
    email: "t@e.com",
    timestamp: 0,
    parents,
    refs: [],
  };
}

const M = "m".repeat(40);
const C = "c".repeat(40);
const F = "f".repeat(40);
const A = "a".repeat(40);
const BASE = "0".repeat(40);

/** root..M, newest-first — the shape `commitsSince` returns. */
const range: CommitInfo[] = [
  mk(M, "Merge branch 'feature'", [C, F]),
  mk(C, "C on main", [A]),
  mk(F, "F on feature", [A]),
  mk(A, "A on main", [BASE]),
];

describe("buildPreservePlan", () => {
  it("emits oldest-first steps that name their own base where it differs", () => {
    const plan = buildPreservePlan(range);
    expect(plan.map((s) => s.oid)).toEqual([A, F, C, M]);

    // A: its parent is below the range → linear default.
    expect(plan[0]).toMatchObject({ action: "Pick", onto: null, mergeParents: [] });
    // F: parent A is the previous step's result → linear default.
    expect(plan[1]).toMatchObject({ action: "Pick", onto: null });
    // C: parent A is NOT the previous step (F was) → must name it.
    expect(plan[2]).toMatchObject({ action: "Pick", onto: A });
    // M: first parent C is the previous step; the other parent is carried.
    expect(plan[3]).toMatchObject({ action: "Merge", onto: null, mergeParents: [F] });
  });

  it("leaves a linear range with no onto at all", () => {
    const linear = [mk(C, "C", [A]), mk(A, "A", [BASE])];
    const plan = buildPreservePlan(linear);
    expect(plan.map((s) => s.onto)).toEqual([null, null]);
    expect(plan.every((s) => s.action === "Pick")).toBe(true);
  });

  it("drops a merge whose other parent is outside the range", () => {
    // A merge of something that is not being replayed cannot be recreated from
    // rewritten parents, so it is flattened instead of producing a plan the
    // backend would reject.
    const outside = "9".repeat(40);
    const withOutside = [mk(M, "Merge external", [C, outside]), mk(C, "C", [A])];
    const plan = buildPreservePlan(withOutside);
    const merge = plan.find((s) => s.oid === M)!;
    expect(merge.action).toBe("Merge");
    expect(merge.mergeParents).toEqual([outside]);
  });
});
```

Note on the third case: an out-of-range parent is *not* dropped — `move_to_base` and `resolved_merge_parents` fall back to the original oid when it was not rewritten, which is exactly right for a parent that lives below the range. The test asserts that the parent is carried through unchanged; keep the name of the test honest by calling it "carries an out-of-range parent through unchanged" if you prefer.

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/buildPreservePlan.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement the builder**

Create `src/features/commits/buildPreservePlan.ts`:

```ts
import type { CommitInfo, RebaseStep } from "@/lib/types";

/**
 * Build a topology-preserving plan for `range` — the commits between a base and
 * HEAD, newest-first, exactly as `commitsSince` returns them.
 *
 * git expresses topology in its todo file with `label` / `reset` / `merge
 * <label>` because a human edits that file. A generated plan does not need the
 * naming layer: every step names the ORIGINAL commit it must be applied onto,
 * and the engine resolves that through the rewritten map. `onto: null` means
 * "onto the previous step's result", so a linear range produces exactly the
 * plan it did before this existed.
 *
 * The step order is the reverse of the log walk, which is TIME | TOPOLOGICAL —
 * parents always precede children. Grouping does not affect correctness because
 * each step carries its own base.
 */
export function buildPreservePlan(range: CommitInfo[]): RebaseStep[] {
  const oldestFirst = [...range].reverse();

  return oldestFirst.map((c, i): RebaseStep => {
    const firstParent = c.parents[0] ?? null;
    const previousOid = i > 0 ? oldestFirst[i - 1].oid : null;
    const isMerge = c.parents.length > 1;

    // Only name a base when it is not where the replay already sits. Naming it
    // unconditionally would work, but it would make every step a reset and
    // hide the linear default from anyone reading the plan.
    const onto = firstParent && firstParent !== previousOid ? firstParent : null;
    // The first step's base is the range's base, which `rebase_start` derives
    // from the commit's parent — carrying it as `onto` too is harmless but
    // noisy, so leave it null.
    const ontoOrNull = i === 0 ? null : onto;

    return {
      oid: c.oid,
      action: isMerge ? "Merge" : "Pick",
      message: null,
      onto: ontoOrNull,
      mergeParents: isMerge ? c.parents.slice(1) : [],
    };
  });
}
```

- [ ] **Step 4: Run the builder tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/buildPreservePlan.test.ts
```

Expected: all three pass.

- [ ] **Step 5: Write the failing screen test**

Create `src/screens/Rebase.preserve.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RebaseScreen } from "./Rebase";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStatus, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };
const SWEPT: RebaseStatus = { inProgress: false, nextIndex: 0, total: 0, pauseReason: null };

function mk(oid: string, summary: string, parents: string[]): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Tester",
    email: "t@e.com",
    timestamp: 1_700_000_000,
    parents,
    refs: [],
  };
}

const M = "m".repeat(40);
const C = "c".repeat(40);
const F = "f".repeat(40);
const A = "a".repeat(40);
const commits = [
  mk(M, "Merge branch 'feature'", [C, F]),
  mk(C, "C on main", [A]),
  mk(F, "F on feature", [A]),
  mk(A, "A on main", ["0".repeat(40)]),
];

beforeEach(() => {
  localStorage.clear();
  useRepoStore.setState({
    current: handle,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits,
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: SWEPT,
    lastRebaseSummary: null,
    activity: {},
  });
  mockInvoke("rebase_status", () => SWEPT);
  useNavStore.setState({
    intent: {
      kind: "rebase-plan",
      plan: [
        { oid: F, action: "Pick", message: null },
        { oid: C, action: "Pick", message: null },
        { oid: M, action: "Drop", message: null },
      ],
    },
  });
});

describe("RebaseScreen preserve mode", () => {
  it("switching to preserve turns the merge row into a Merge step", async () => {
    render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");

    await userEvent.click(screen.getByTestId("rebase-merge-mode-preserve"));

    const rows = screen.getAllByTestId("rebase-row");
    const mergeRow = rows.find((r) => r.getAttribute("data-sha") === M.slice(0, 7))!;
    expect(mergeRow.getAttribute("data-action")).toBe("Merge");
    expect([...mergeRow.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      "Merge",
      "Drop",
    ]);
  });

  it("states the cost of preserving and disables reordering", async () => {
    render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");
    await userEvent.click(screen.getByTestId("rebase-merge-mode-preserve"));

    const warning = screen.getByTestId("rebase-merge-warning");
    expect(warning.textContent).toContain("recreated");
    expect(warning.textContent).toContain("not preserved");
    expect(warning.textContent).toContain("Reordering is disabled");

    expect(screen.queryAllByTestId("rebase-move-up")).toHaveLength(0);
    expect(screen.queryAllByTestId("rebase-move-down")).toHaveLength(0);
  });

  it("remembers the mode across mounts", async () => {
    const first = render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");
    await userEvent.click(screen.getByTestId("rebase-merge-mode-preserve"));
    first.unmount();

    render(<RebaseScreen />);
    expect(await screen.findByTestId("rebase-merge-mode-preserve")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
```

- [ ] **Step 6: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/Rebase.preserve.test.tsx
```

Expected: fails — no mode toggle exists.

- [ ] **Step 7: Implement the persisted mode**

Create `src/features/rebase/useRebaseMergeMode.ts`, mirroring `src/lib/useTreeViewMode.ts`:

```ts
// Flatten ⇄ preserve for merge commits in a rebase plan, persisted like the
// other per-surface view preferences: localStorage, best-effort, never fatal.
//
// "flatten" is the default because it is git's own (`git rebase -i` drops merge
// commits and linearises); "preserve" is the `--rebase-merges` equivalent and
// carries costs the Rebase screen states up front.

import React from "react";

export type RebaseMergeMode = "flatten" | "preserve";

const STORAGE_KEY = "pg-rebase-merge-mode";

function read(): RebaseMergeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "preserve" ? "preserve" : "flatten";
  } catch {
    return "flatten";
  }
}

export function useRebaseMergeMode(): [RebaseMergeMode, (m: RebaseMergeMode) => void] {
  const [mode, setMode] = React.useState<RebaseMergeMode>(read);
  const update = React.useCallback((m: RebaseMergeMode) => {
    setMode(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // non-fatal — the session just won't remember the choice
    }
  }, []);
  return [mode, update];
}
```

- [ ] **Step 8: Wire the screen**

In `src/screens/Rebase.tsx`:

`PlanRow` gains the two topology fields so `handleStart` can send them:

```tsx
interface PlanRow {
  oid: string;
  shortOid: string;
  subject: string;
  action: RebaseAction;
  message: string;
  isMerge: boolean;
  onto: string | null;
  mergeParents: string[];
}

/** Mirrors rebase_plan::merge_legal, per mode. */
const MERGE_ACTIONS_FLATTEN: RebaseAction[] = ["Drop", "MainlinePick"];
const MERGE_ACTIONS_PRESERVE: RebaseAction[] = ["Merge", "Drop"];
```

Build rows from the mode. Replace `commitsToPlan(range)` calls with a mode-aware builder:

```tsx
function commitsToPlan(commits: CommitInfo[], mode: RebaseMergeMode): PlanRow[] {
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  const steps =
    mode === "preserve"
      ? buildPreservePlan(commits)
      : // Flatten: oldest-first picks, merges dropped (PR2's default).
        [...commits].reverse().map((c) => ({
          oid: c.oid,
          action: (c.parents.length > 1 ? "Drop" : "Pick") as RebaseAction,
          message: null,
          onto: null,
          mergeParents: [] as string[],
        }));

  return steps.map((step) => {
    const c = byOid.get(step.oid);
    return {
      oid: step.oid,
      shortOid: c?.shortOid ?? step.oid.slice(0, 7),
      subject: c?.summary ?? "",
      action: step.action,
      message: step.message ?? "",
      isMerge: (c?.parents.length ?? 0) > 1,
      onto: step.onto ?? null,
      mergeParents: step.mergeParents ?? [],
    };
  });
}
```

Hold the mode and rebuild when it changes. Next to the existing state:

```tsx
  const [mergeMode, setMergeMode] = useRebaseMergeMode();
  // The range the plan was built from, kept so a mode switch can rebuild it
  // without asking the backend again.
  const [range, setRange] = useState<CommitInfo[]>([]);
```

`handlePickBase` stores the range (`setRange(range)`) and builds with the current mode; the NavIntent effect stores the intent's commits as the range (`setRange(intent.plan.map((s) => byOid.get(s.oid)).filter(Boolean) as CommitInfo[])` — reversed to newest-first, since the intent's plan is oldest-first) and then builds. Add an effect so a mode switch rebuilds:

```tsx
  React.useEffect(() => {
    if (range.length === 0) return;
    setPlan(commitsToPlan(range, mergeMode));
  }, [mergeMode, range]);
```

Toolbar toggle, next to "Change base":

```tsx
            <div style={{ display: "flex", gap: 2 }}>
              {(["flatten", "preserve"] as const).map((m) => (
                <PGButton
                  key={m}
                  size="sm"
                  variant={mergeMode === m ? "primary" : "ghost"}
                  aria-pressed={mergeMode === m}
                  data-testid={`rebase-merge-mode-${m}`}
                  onClick={() => setMergeMode(m)}
                  title={
                    m === "flatten"
                      ? "Drop merge commits and replay their commits individually (git's default)"
                      : "Recreate merge commits, keeping the branch structure"
                  }
                >
                  {m === "flatten" ? "Flatten merges" : "Preserve merges"}
                </PGButton>
              ))}
            </div>
```

Warning copy per mode — replace the strip's body from PR2 with a branch on `mergeMode`:

```tsx
              <span>
                {mergeCount === 1 ? "1 merge commit" : `${mergeCount} merge commits`} in this
                range.{" "}
                {mergeMode === "flatten" ? (
                  <>
                    Flattening drops {mergeCount === 1 ? "it" : "them"} and replays the merged
                    commits individually — the branch becomes linear. Choose{" "}
                    <strong>keep as one</strong> on a merge row to keep it as a single commit.
                  </>
                ) : (
                  <>
                    They will be recreated by re-merging their new parents. Conflict resolutions
                    and manual edits inside the original merges are{" "}
                    <strong>not preserved</strong> and may need redoing. Reordering is disabled in
                    this mode.
                  </>
                )}
              </span>
```

Restricted actions per mode, and the reorder lock:

```tsx
                        options={
                          row.isMerge
                            ? mergeMode === "preserve"
                              ? MERGE_ACTIONS_PRESERVE
                              : MERGE_ACTIONS_FLATTEN
                            : undefined
                        }
```

```tsx
                    {mergeMode === "flatten" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                        <PGButton
                          size="xs"
                          variant="ghost"
                          icon="chevronUp"
                          data-testid="rebase-move-up"
                          onClick={() => moveRow(i, -1)}
                          style={{ opacity: i === 0 ? 0.3 : 1, pointerEvents: i === 0 ? "none" : undefined }}
                        />
                        <PGButton
                          size="xs"
                          variant="ghost"
                          icon="chevronDown"
                          data-testid="rebase-move-down"
                          onClick={() => moveRow(i, 1)}
                          style={{
                            opacity: i === plan.length - 1 ? 0.3 : 1,
                            pointerEvents: i === plan.length - 1 ? "none" : undefined,
                          }}
                        />
                      </div>
                    )}
```

`handleStart` sends the topology fields:

```tsx
    const steps: RebaseStep[] = plan.map((r) => ({
      oid: r.oid,
      action: r.action,
      message: r.action === "Reword" || r.action === "Squash" ? (r.message || null) : null,
      onto: r.onto,
      mergeParents: r.mergeParents,
    }));
```

Add the imports: `buildPreservePlan` from `@/features/commits/buildPreservePlan`, `useRebaseMergeMode` + `RebaseMergeMode` from `@/features/rebase/useRebaseMergeMode`.

- [ ] **Step 9: Run the frontend suite**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/Rebase
pnpm test
pnpm tsc --noEmit
```

Expected: the three preserve tests pass, PR2's `Rebase.merge.test.tsx` still passes (default mode is flatten), whole suite green.

- [ ] **Step 10: Commit**

```bash
git add src/features/commits/buildPreservePlan.ts src/features/commits/buildPreservePlan.test.ts \
        src/features/rebase/useRebaseMergeMode.ts src/screens/Rebase.tsx \
        src/screens/Rebase.preserve.test.tsx
git commit -m "feat(rebase): preserve-merges mode in the Rebase screen

Why: flattening is the right default, but a deliberate branch structure
is worth keeping. Preserve mode builds a topology-aware plan (each step
names its own base, merges carry their other parents), states that
original conflict resolutions are not reused, and disables reordering —
git documents its own reorder bugs under --rebase-merges."
```

---

### Task 5: E2E — a preserving run keeps the merge

**Files:**
- Modify: `e2e/specs/rebase.e2e.ts`

- [ ] **Step 1: Write the spec**

Append inside `describe("interactive rebase")` in `e2e/specs/rebase.e2e.ts`:

```ts
  it("preserves a merge commit when preserve mode is on", async () => {
    repo = mergeRangeRepo();
    const originalMerge = repo.git("rev-parse", "HEAD").trim();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await switchScreen("history");
    await scrollCommitListTo("feat: a on main");
    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: a on main" });
    await jsClickMenuItem("Interactive rebase from here");
    await $('[data-testid="rebase-row"]').waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: "rebase plan never appeared",
    });

    await $('[data-testid="rebase-merge-mode-preserve"]').click();
    const warning = $('[data-testid="rebase-merge-warning"]');
    await warning.waitForDisplayed({ timeout: 10_000 });
    expect(await warning.getText()).toContain("not preserved");

    await $('[data-testid="rebase-start"]').click();
    await $('[data-testid="rebase-last-summary"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "preserving rebase never reported completion",
    });

    // The merge survives as a merge, and it is a NEW commit (the range was
    // replayed), with both sides' content present.
    expect(repo.git("log", "--merges", "--format=%s").trim()).toBe("Merge branch 'feature'");
    expect(repo.git("rev-parse", "HEAD").trim()).not.toBe(originalMerge);
    expect(repo.git("rev-list", "--count", "HEAD^2").trim()).not.toBe("0");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
```

- [ ] **Step 2: Rebuild the snapshot and run the spec**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts
```

Expected: the whole rebase spec file passes. Never run e2e natively.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/rebase.e2e.ts
git commit -m "test(e2e): a preserving rebase keeps the merge commit"
```

---

### Task 6: Whole-suite gate, docs, PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run every layer**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
pnpm test
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts --spec e2e/specs/merge-conflict.e2e.ts
```

- [ ] **Step 2: Document the preserve contract**

In `CLAUDE.md`, extend the rebase notes:

```markdown
- **Rebase plans carry topology structurally, not as git's todo language.** A
  `RebaseStep` may name the original commit it is applied `onto` (resolved
  through the engine's rewritten map, so every commit is implicitly its own
  label), and a `Merge` step carries its original parents beyond the first. A
  plan whose steps all leave `onto: null` is the linear default. There are no
  `label` / `reset` / `exec` steps and no `rebase-cousins` mode — a generated
  plan does not need the naming layer.
- `rebase_plan::merge_legal` is the source of truth for the actions a merge row
  may carry; the screen mirrors it as `MERGE_ACTIONS_FLATTEN` (`Drop`,
  `MainlinePick`) and `MERGE_ACTIONS_PRESERVE` (`Merge`, `Drop`) — keep all three
  in sync or the UI offers something the backend refuses.
- **Preserve mode does not reuse original conflict resolutions** (neither does
  git) and disables reordering, because git's own reorder support under
  `--rebase-merges` is documented as buggy. Octopus merges cannot be recreated;
  they can be dropped or kept as one commit.
```

Also add `features/rebase/` to the frontend architecture listing:

```
├── rebase/          RebaseBasePicker + useRebaseMergeMode (persisted
│                    flatten ⇄ preserve for merge commits in a plan)
```

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md
git commit -m "docs: note how rebase plans express topology"
git push -u origin HEAD
gh pr create --title "feat(rebase): recreate merge commits (preserve mode)" --body "$(cat <<'EOF'
## What

PR3 of three from `docs/superpowers/specs/2026-08-14-rebase-merge-commits-design.md`.

Interactive rebase can now keep branch topology — the equivalent of
`git rebase --rebase-merges`, opt-in behind a toggle that states its costs.

- `RebaseStep.onto` names the original commit a step applies onto; the engine
  resolves it through the rewritten map and resets the detached HEAD there. That
  replaces git's `label` / `reset` todo language — every commit is implicitly its
  own label, and the plan stays a flat, reorderable list.
- `RebaseAction::Merge` re-merges a merge's rewritten parents in the worktree and
  commits with the original message and parent count. A conflict pauses through
  the existing machinery, so `conflict_sides`, the Conflict screen, and the merge
  resolver window all work unchanged; continuing commits the resolution as a
  two-parent merge.
- Octopus merges are refused explicitly (drop or keep-as-one instead) rather than
  mis-recreated.
- The Rebase screen gains a persisted Flatten ⇄ Preserve toggle. Preserve states
  that original conflict resolutions are not reused and disables reordering,
  matching git's own documented limitation.

## Testing

`cargo test` (new: `rebase_preserve.rs` — `onto` resets, clean recreate,
conflicting recreate through `conflict_sides` and continue, octopus rejection),
`pnpm test` (new: `buildPreservePlan.test.ts`, `Rebase.preserve.test.tsx`),
`pnpm tsc --noEmit`, and `pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts
--spec e2e/specs/merge-conflict.e2e.ts`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
