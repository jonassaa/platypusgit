# Issue #61 Tier 2, PR 1 — set-upstream, content log search, skeletons

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three small independent items of #61 Tier 2 — editable branch tracking (D9), content search in the log (D10), and skeleton loaders (B6).

**Architecture:** D9 follows CLAUDE.md's standard "adding a new git op" path end to end (trait → libgit2 → CliBackend stub → command → registry → TS wrapper → store → UI). D10 adds two fields to `LogFilter` and one predicate to the existing `log_filtered_page` walk, positioned last because it is the only filter that costs a diff per commit. B6 adds a presentational `PGSkeleton` primitive driving the already-defined `.pg-shimmer` keyframe and applies it at three load sites.

**Tech Stack:** Rust + git2 0.20 + the new `regex` crate; React 19 + TypeScript + Zustand; vitest + React Testing Library; `cargo test` for backend integration over the `TempRepo` fixture.

**Spec:** `docs/superpowers/specs/2026-08-13-issue-61-tier2-design.md`

## Global Constraints

- **Toolchain PATH.** Every `pnpm`/`cargo` command must be prefixed with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` — the Bash tool does not inherit the interactive shell rc.
- **Node 22 + pnpm.** Never npm, never yarn.
- **Errors:** every IPC-crossing Rust fn returns `AppResult<T>`. Add an `AppError` variant rather than stringifying. A new Rust variant updates `src/lib/errors.ts` in the **same commit**.
- **Frontend never calls `invoke()` directly** — only via typed wrappers in `src/lib/tauri.ts`.
- **`git2::Repository` is not `Sync`** — every git2 call from a Tauri command goes through `tokio::task::spawn_blocking`.
- **`CliBackend` gets a `NotImplemented` stub for every new trait method** — keeps the trait shape exercised.
- **Any new list-row surface opts into UI density:** `height: "calc(<base>px + var(--row-step))"`, or `padding: "calc(<base>px + var(--row-step) / 2) …"` for padding-sized rows. `--row-step` is 0 in compact.
- **Never hardcode the accent hue** — use `var(--accent)` or `oklch(from var(--accent) l c h / <alpha>)`.
- **Import UI primitives from `@/design`**, never per-file. New primitive → add file in `src/design/` and re-export from `src/design/index.ts`.
- **Dialogs:** `pgConfirm` / `pgPrompt` from `@/design`. Never `window.confirm` / `window.prompt`.
- **Commit style:** Conventional Commits, imperative subject under 72 chars, `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer.
- **E2E:** only via `pnpm test:e2e:docker`, never natively, only when done developing, only the affected specs.

---

### Task 1: Add the `InvalidArgument` error variant

`AppError` has no variant for "the caller passed something invalid" — the closest, `InvalidRef`, is specifically about references. D10's malformed-regex case and (in PR 2) D7's empty line selection both need it.

**Files:**
- Modify: `src-tauri/src/error.rs:5-52` (enum)
- Modify: `src/lib/errors.ts:1-17` (union)

**Interfaces:**
- Produces: `AppError::InvalidArgument(String)` in Rust; `{ kind: "InvalidArgument"; message: string }` in the TS union.

- [ ] **Step 1: Add the Rust variant**

In `src-tauri/src/error.rs`, directly after the `InvalidRef` variant:

```rust
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
```

- [ ] **Step 2: Mirror it in the TS union**

In `src/lib/errors.ts`, directly after the `InvalidRef` line:

```typescript
  | { kind: "InvalidArgument"; message: string }
```

- [ ] **Step 3: Verify both sides compile**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc --noEmit
```
Expected: both succeed with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/error.rs src/lib/errors.ts
git commit -m "feat(errors): add InvalidArgument variant

Why: a malformed regex or an empty line selection is a caller-argument
problem, not an InvalidRef and not an internal error. Mirrored into
errors.ts the same commit, per the 1:1 convention.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: D9 backend — `set_upstream`

**Files:**
- Modify: `src-tauri/src/git/mod.rs:199-202` (trait, beside the other branch ops)
- Modify: `src-tauri/src/git/libgit2.rs` (impl, beside `rename_branch`)
- Modify: `src-tauri/src/git/cli.rs` (stub)
- Test: `src-tauri/tests/branches_tags.rs` (append)

**Interfaces:**
- Produces: `fn set_upstream(&self, repo_id: &RepoId, branch: &str, upstream: Option<&str>) -> AppResult<()>` on `GitBackend`. `Some("origin/main")` sets tracking; `None` clears it. Unknown local branch or unknown remote-tracking branch → `AppError::InvalidRef`.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/branches_tags.rs`:

```rust
/// Create a second repo as `origin`, fetch it, so remote-tracking refs exist.
fn with_origin() -> (TempRepo, TempRepo) {
    let upstream = TempRepo::with_initial_commit("hello\n");
    let local = TempRepo::with_initial_commit("hello\n");
    local
        .repo
        .remote("origin", upstream.path().to_str().unwrap())
        .unwrap();
    let mut remote = local.repo.find_remote("origin").unwrap();
    remote
        .fetch(&["refs/heads/*:refs/remotes/origin/*"], None, None)
        .unwrap();
    (local, upstream)
}

#[test]
fn set_upstream_sets_tracking_branch() {
    let (tr, _up) = with_origin();
    let (backend, handle) = tr.open_with_backend();

    backend
        .set_upstream(&handle.id, "main", Some("origin/main"))
        .expect("set upstream");

    let branches = backend.branches(&handle.id).unwrap();
    let main = branches
        .iter()
        .find(|b| b.name == "main" && !b.is_remote)
        .expect("main branch");
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
}

#[test]
fn set_upstream_none_clears_tracking() {
    let (tr, _up) = with_origin();
    let (backend, handle) = tr.open_with_backend();
    backend
        .set_upstream(&handle.id, "main", Some("origin/main"))
        .unwrap();

    backend
        .set_upstream(&handle.id, "main", None)
        .expect("clear upstream");

    let branches = backend.branches(&handle.id).unwrap();
    let main = branches
        .iter()
        .find(|b| b.name == "main" && !b.is_remote)
        .unwrap();
    assert!(main.upstream.is_none(), "tracking should be cleared");
}

#[test]
fn set_upstream_unknown_remote_branch_is_invalid_ref() {
    let (tr, _up) = with_origin();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .set_upstream(&handle.id, "main", Some("origin/nope"))
        .expect_err("should reject unknown remote branch");

    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)),
        "expected InvalidRef, got {err:?}"
    );
}

#[test]
fn set_upstream_unknown_local_branch_is_invalid_ref() {
    let (tr, _up) = with_origin();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .set_upstream(&handle.id, "nope", Some("origin/main"))
        .expect_err("should reject unknown local branch");

    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)),
        "expected InvalidRef, got {err:?}"
    );
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test branches_tags 2>&1 | tail -20
```
Expected: compile error — `no method named set_upstream found for struct Libgit2Backend`.

- [ ] **Step 3: Add the trait method**

In `src-tauri/src/git/mod.rs`, immediately after the `rename_branch` line (currently `:202`):

```rust
    /// Set or clear a local branch's upstream (tracking) branch.
    ///
    /// `upstream` is a remote-tracking branch shorthand such as
    /// `"origin/main"`; `None` clears tracking. Both the local branch and the
    /// remote-tracking branch must exist — either missing is `InvalidRef`,
    /// which is why this validates before mutating rather than letting
    /// libgit2 fail deep inside with a stringified message.
    fn set_upstream(
        &self,
        repo_id: &RepoId,
        branch: &str,
        upstream: Option<&str>,
    ) -> AppResult<()>;
```

- [ ] **Step 4: Implement it in `Libgit2Backend`**

In `src-tauri/src/git/libgit2.rs`, immediately after the `rename_branch` impl:

```rust
    fn set_upstream(
        &self,
        repo_id: &RepoId,
        branch: &str,
        upstream: Option<&str>,
    ) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            // Validate the remote-tracking branch BEFORE touching config, so a
            // typo is a clean InvalidRef instead of a stringified libgit2 error.
            if let Some(up) = upstream {
                repo.find_branch(up, BranchType::Remote)
                    .map_err(|_| AppError::InvalidRef(up.to_string()))?;
            }
            let mut local = repo
                .find_branch(branch, BranchType::Local)
                .map_err(|_| AppError::InvalidRef(branch.to_string()))?;
            local.set_upstream(upstream)?;
            Ok(())
        })
    }
```

- [ ] **Step 5: Add the `CliBackend` stub**

In `src-tauri/src/git/cli.rs`, beside the other branch stubs:

```rust
    fn set_upstream(
        &self,
        _repo_id: &RepoId,
        _branch: &str,
        _upstream: Option<&str>,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test branches_tags 2>&1 | tail -20
```
Expected: all four new tests pass, existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs src-tauri/tests/branches_tags.rs
git commit -m "feat(branches): set_upstream backend op (#61 D9)

Why: BranchInfo.upstream/ahead/behind were displayed but tracking could
not be changed. Validates the remote-tracking branch before mutating so a
typo surfaces as InvalidRef, the shape the UI already handles.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: D9 command, wrapper and store action

**Files:**
- Modify: `src-tauri/src/commands/branches.rs` (new command beside `rename_branch`)
- Modify: `src-tauri/src/lib.rs` (`invoke_handler!` registry)
- Modify: `src/lib/tauri.ts:353-359` (beside `renameBranch`)
- Modify: `src/features/repo/useRepoStore.ts` (import list, interface, action beside `renameBranch:780`)

**Interfaces:**
- Consumes: `GitBackend::set_upstream` from Task 2.
- Produces: Tauri command `set_upstream`; `setUpstream(repoId: string, branch: string, upstream: string | null): Promise<void>` in `lib/tauri.ts`; `setUpstream(branch: string, upstream: string | null): Promise<void>` on `useRepoStore`.

- [ ] **Step 1: Add the Tauri command**

In `src-tauri/src/commands/branches.rs`, beside the other branch commands:

```rust
#[tauri::command]
pub async fn set_upstream(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    upstream: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || {
        backend.set_upstream(&repo_id, &branch, upstream.as_deref())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 2: Register it**

In `src-tauri/src/lib.rs`, add `commands::branches::set_upstream` to `invoke_handler![…]` beside `rename_branch`.

- [ ] **Step 3: Add the typed wrapper**

In `src/lib/tauri.ts`, directly after `renameBranch`:

```typescript
/**
 * Set or clear a branch's upstream. `null` clears tracking; a remote-tracking
 * shorthand such as `"origin/main"` sets it.
 */
export async function setUpstream(
  repoId: string,
  branch: string,
  upstream: string | null,
): Promise<void> {
  return invoke<void>("set_upstream", { repoId, branch, upstream });
}
```

- [ ] **Step 4: Add the store action**

In `src/features/repo/useRepoStore.ts`: add `setUpstream` to the import list from `@/lib/tauri`, add to the store interface beside `renameBranch`:

```typescript
  setUpstream: (branch: string, upstream: string | null) => Promise<void>;
```

and the action beside `renameBranch` (`:780`):

```typescript
  async setUpstream(branch, upstream) {
    const repo = get().current;
    if (!repo) return;
    try {
      await setUpstream(repo.id, branch, upstream);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },
```

- [ ] **Step 5: Verify it compiles**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc --noEmit
```
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/branches.rs src-tauri/src/lib.rs src/lib/tauri.ts src/features/repo/useRepoStore.ts
git commit -m "feat(branches): wire set_upstream through command and store (#61 D9)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: D9 UI — Branches inspector and branch context menu

Both entry points route through `pgPrompt`, relying on the contract that `design/dialog.tsx` already guarantees: **an empty submitted string is distinct from a cancelled dialog**. Empty clears tracking; cancel does nothing.

**Files:**
- Modify: `src/screens/Branches.tsx:766` (`Tracks` KV row) and `BranchActions` (`:789`)
- Modify: `src/design/context-menu.tsx:613` (`branchMenuItems`)
- Test: `src/screens/Branches.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `useRepoStore().setUpstream` from Task 3; `pgPrompt` from `@/design`.

- [ ] **Step 1: Write the failing component test**

Create or append to `src/screens/Branches.test.tsx`. Note `WithDialogs` — without it every dialog resolves as cancelled and the assertion silently cannot pass:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WithDialogs } from "@/test/dialog";
import { mockInvoke } from "@/test/setup";
import { Branches } from "./Branches";

describe("Branches upstream editing", () => {
  it("sends the typed upstream to set_upstream", async () => {
    const calls: unknown[] = [];
    mockInvoke("set_upstream", (args) => {
      calls.push(args);
      return undefined;
    });

    render(
      <WithDialogs>
        <Branches />
      </WithDialogs>,
    );

    await userEvent.click(await screen.findByText("main"));
    await userEvent.click(screen.getByRole("button", { name: /set upstream/i }));
    const input = await screen.findByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "origin/main");
    await userEvent.click(screen.getByRole("button", { name: /^ok$/i }));

    await waitFor(() =>
      expect(calls).toEqual([
        expect.objectContaining({ branch: "main", upstream: "origin/main" }),
      ]),
    );
  });
});
```

> If `Branches` needs seeded repo state to render a branch list, seed it through `mockInvoke("list_branches", …)` and whatever `open_repo`/`get_status` responses the existing screen tests use — copy the setup from the nearest existing screen test rather than inventing one.

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/Branches.test.tsx 2>&1 | tail -20
```
Expected: FAIL — no "Set upstream" button exists.

- [ ] **Step 3: Add the inspector actions**

In `src/screens/Branches.tsx`, add a helper above `BranchActions`:

```tsx
/**
 * Prompt for a branch's upstream. Empty submitted string clears tracking;
 * a cancelled dialog (null) does nothing — the empty-vs-null distinction
 * pgPrompt guarantees is what makes a prompt sufficient here.
 */
async function promptUpstream(branch: BranchInfo) {
  const next = await pgPrompt({
    title: `Upstream for ${branch.name}`,
    body: "Remote-tracking branch, e.g. origin/main. Empty clears tracking.",
    initialValue: branch.upstream ?? "",
    placeholder: "origin/main",
    mono: true,
    // NOT requireValue: an empty submission is the "clear tracking" path.
  });
  if (next === null) return;
  const trimmed = next.trim();
  await useRepoStore
    .getState()
    .setUpstream(branch.name, trimmed === "" ? null : trimmed);
}
```

Then in `BranchActions`, for local branches only:

```tsx
      {!branch.isRemote && (
        <PGButton icon="link" onClick={() => void promptUpstream(branch)}>
          Set upstream
        </PGButton>
      )}
```

Import `pgPrompt` from `@/design`. Use an icon name that exists in `design/icons.tsx`; if `link` is absent, pick an existing one rather than adding a glyph in this task.

- [ ] **Step 4: Add the context-menu entry**

In `src/design/context-menu.tsx`, inside `branchMenuItems` (`:613`), for local branches, following the existing item shape in that builder:

```tsx
    {
      label: "Set upstream…",
      icon: "link",
      onSelect: () => void promptUpstreamFor(branch),
    },
```

`branchMenuItems` builds items declaratively and does not import screens, so put `promptUpstreamFor` next to the other action helpers already used by this builder, calling `useRepoStore.getState().setUpstream` the same way. If the builder's existing items call store actions inline, match that instead of adding an indirection.

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/Branches.test.tsx 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/Branches.tsx src/design/context-menu.tsx src/screens/Branches.test.tsx
git commit -m "feat(branches): set/clear upstream from inspector and context menu (#61 D9)

Why: empty prompt string clears tracking, cancel is a no-op — the
empty-vs-null contract pgPrompt already guarantees, which is what makes a
prompt adequate here instead of a bespoke picker.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: D9 — first push establishes tracking

`push` (`commands/branches.rs:198-218`) never passes `-u`, so a branch created in the app never gets an upstream from pushing it. Add `-u` when and only when the branch has no upstream yet.

**Files:**
- Modify: `src-tauri/src/commands/branches.rs:198-218` (`push`)
- Test: `src-tauri/tests/network.rs` (append)

**Interfaces:**
- Consumes: `GitBackend::branches` to read current tracking.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/network.rs`. Push against a bare local repo — no network, no credentials:

```rust
#[test]
fn push_of_untracked_branch_sets_upstream() {
    // Bare repo acting as `origin`.
    let bare_dir = tempfile::tempdir().unwrap();
    git2::Repository::init_bare(bare_dir.path()).unwrap();

    let tr = support::TempRepo::with_initial_commit("hello\n");
    tr.repo
        .remote("origin", bare_dir.path().to_str().unwrap())
        .unwrap();

    // Push with -u the same way the command does.
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(tr.path())
        .args(["push", "-u", "origin", "main"])
        .output()
        .unwrap();
    assert!(out.status.success(), "push failed: {:?}", out);

    let (backend, handle) = tr.open_with_backend();
    let branches = backend.branches(&handle.id).unwrap();
    let main = branches
        .iter()
        .find(|b| b.name == "main" && !b.is_remote)
        .unwrap();
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
}
```

> This test pins the *behaviour we rely on* (`git push -u` leaves an upstream that `branches()` reports). The command's own branching is covered by the pure helper test in Step 3.

- [ ] **Step 2: Run it**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test network 2>&1 | tail -20
```
Expected: PASS (it documents git's behaviour). If it fails, the local git is too old for `-u` on a file remote — stop and report rather than working around it.

- [ ] **Step 3: Add a pure helper plus its test**

In `src-tauri/src/commands/branches.rs`, above `push`:

```rust
/// Build `git push` args. `set_upstream` adds `-u`, which the caller passes
/// only when the branch has no upstream yet — re-sending `-u` on every push
/// would rewrite tracking the user may have deliberately pointed elsewhere.
fn push_args(remote: &str, branch: &str, force: PushForce, set_upstream: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["push".to_string()];
    if set_upstream {
        args.push("-u".to_string());
    }
    args.push(remote.to_string());
    args.push(branch.to_string());
    match force {
        PushForce::None => {}
        PushForce::WithLease => args.push("--force-with-lease".to_string()),
        PushForce::Force => args.push("--force".to_string()),
    }
    args
}

#[cfg(test)]
mod push_args_tests {
    use super::*;

    #[test]
    fn adds_u_only_when_requested() {
        assert_eq!(
            push_args("origin", "main", PushForce::None, true),
            vec!["push", "-u", "origin", "main"]
        );
        assert_eq!(
            push_args("origin", "main", PushForce::None, false),
            vec!["push", "origin", "main"]
        );
    }

    #[test]
    fn force_flag_comes_last() {
        assert_eq!(
            push_args("origin", "main", PushForce::WithLease, false),
            vec!["push", "origin", "main", "--force-with-lease"]
        );
    }
}
```

- [ ] **Step 4: Use it in `push`**

Replace the body of `push` with:

```rust
    let repo_id = RepoId(repo_id);
    let path = get_repo_path(&state, &repo_id).await?;

    // -u only for a branch with no upstream yet: re-sending it on every push
    // would silently rewrite tracking the user may have pointed elsewhere.
    let needs_upstream = {
        let backend = state.backend.clone();
        let id = repo_id.clone();
        let branch_name = branch.clone();
        tokio::task::spawn_blocking(move || backend.branches(&id))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .map(|bs| {
                bs.iter()
                    .any(|b| !b.is_remote && b.name == branch_name && b.upstream.is_none())
            })
            // A failure to read branches must not block the push; fall back to
            // a plain push rather than guessing -u.
            .unwrap_or(false)
    };

    let args = push_args(&remote, &branch, force, needs_upstream);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git(&path, &arg_refs).await
```

- [ ] **Step 5: Run the tests**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
```
Expected: all pass, including `push_args_tests`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/branches.rs src-tauri/tests/network.rs
git commit -m "feat(push): set upstream on first push of an untracked branch (#61 D9)

Why: -u only when the branch has no upstream — re-sending it every push
would rewrite tracking the user may have deliberately pointed elsewhere.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: D10 backend — content predicate in the log walk

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `regex`)
- Modify: `src-tauri/src/git/types.rs` (`LogFilter` + `is_empty`)
- Modify: `src-tauri/src/git/libgit2.rs:1304-1426` (`log_filtered_page`)
- Test: `src-tauri/tests/log_filter.rs` (append)

**Interfaces:**
- Consumes: `AppError::InvalidArgument` from Task 1.
- Produces: `LogFilter.content: Option<String>` and `LogFilter.content_regex: bool`. `-G` semantics: the pattern appears in a line the commit added or removed, comparing against the **first parent**.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/log_filter.rs`:

```rust
/// Repo where one commit adds a needle line and a later one removes it.
fn needle_repo() -> TempRepo {
    let tr = TempRepo::fresh();
    commit_as(&tr, "a.txt", "alpha\n", "first", "Alice", "alice@example.com", 1000);
    commit_as(&tr, "a.txt", "alpha\nNEEDLE here\n", "add needle", "Alice", "alice@example.com", 2000);
    commit_as(&tr, "a.txt", "alpha\n", "drop needle", "Bob", "bob@example.com", 3000);
    commit_as(&tr, "b.txt", "unrelated\n", "unrelated", "Bob", "bob@example.com", 4000);
    tr
}

#[test]
fn content_filter_finds_adding_and_removing_commits() {
    let tr = needle_repo();
    let (backend, handle) = tr.open_with_backend();

    let filter = LogFilter {
        content: Some("NEEDLE".into()),
        ..Default::default()
    };
    let found = backend.log_filtered(&handle.id, &filter, None, 50).unwrap();

    let subjects: Vec<&str> = found.iter().map(|c| c.summary.as_str()).collect();
    assert!(subjects.contains(&"add needle"), "got {subjects:?}");
    assert!(subjects.contains(&"drop needle"), "removal counts too: {subjects:?}");
    assert!(!subjects.contains(&"unrelated"), "got {subjects:?}");
    assert!(!subjects.contains(&"first"), "got {subjects:?}");
}

#[test]
fn content_filter_regex_mode_matches() {
    let tr = needle_repo();
    let (backend, handle) = tr.open_with_backend();

    let filter = LogFilter {
        content: Some("NEE.LE".into()),
        content_regex: true,
        ..Default::default()
    };
    let found = backend.log_filtered(&handle.id, &filter, None, 50).unwrap();
    assert_eq!(found.len(), 2, "regex should match both needle commits");
}

#[test]
fn content_filter_substring_mode_does_not_treat_pattern_as_regex() {
    let tr = needle_repo();
    let (backend, handle) = tr.open_with_backend();

    let filter = LogFilter {
        content: Some("NEE.LE".into()),
        ..Default::default()
    };
    let found = backend.log_filtered(&handle.id, &filter, None, 50).unwrap();
    assert!(found.is_empty(), "substring mode must be literal");
}

#[test]
fn content_filter_bad_regex_errors_before_walking() {
    let tr = needle_repo();
    let (backend, handle) = tr.open_with_backend();

    let filter = LogFilter {
        content: Some("([unclosed".into()),
        content_regex: true,
        ..Default::default()
    };
    let err = backend
        .log_filtered(&handle.id, &filter, None, 50)
        .expect_err("bad regex must error");
    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidArgument(_)),
        "expected InvalidArgument, got {err:?}"
    );
}

#[test]
fn content_filter_intersects_with_path_filter() {
    let tr = needle_repo();
    let (backend, handle) = tr.open_with_backend();

    let filter = LogFilter {
        content: Some("NEEDLE".into()),
        path: Some("b.txt".into()),
        ..Default::default()
    };
    let found = backend.log_filtered(&handle.id, &filter, None, 50).unwrap();
    assert!(found.is_empty(), "needle is in a.txt, not b.txt");
}
```

> `LogFilter` needs `#[derive(Default)]` for `..Default::default()`. If it does not derive it yet, add it in Step 3 — the existing tests construct it field-by-field and are unaffected.

- [ ] **Step 2: Run to verify failure**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test log_filter 2>&1 | tail -20
```
Expected: compile error — no field `content` on `LogFilter`.

- [ ] **Step 3: Add the dependency and the filter fields**

In `src-tauri/Cargo.toml`, in `[dependencies]`:

```toml
# Content log search (#61 D10) compiles the user's pattern once per walk.
regex = "1"
```

In `src-tauri/src/git/types.rs`, add to `LogFilter` (and `#[derive(Default)]` if missing):

```rust
    /// Pattern that must appear in a line this commit added or removed
    /// (git's `-G`, not `-S`: this is "the text was touched", not
    /// "the occurrence count changed").
    pub content: Option<String>,
    /// Treat `content` as a regular expression rather than a literal substring.
    #[serde(default)]
    pub content_regex: bool,
```

and extend `is_empty`:

```rust
            && self.content.as_deref().map(str::trim).unwrap_or("").is_empty()
```

> `content_regex` alone must NOT make a filter non-empty — a regex toggle with no pattern is still no filter.

- [ ] **Step 4: Add the diff-scan helper**

In `src-tauri/src/git/libgit2.rs`, beside `commit_touches_path` (`:3107`):

```rust
/// Compiled content predicate: literal substring or regex.
enum ContentMatcher {
    Literal(String),
    Regex(regex::Regex),
}

impl ContentMatcher {
    fn is_match(&self, line: &str) -> bool {
        match self {
            ContentMatcher::Literal(s) => line.contains(s.as_str()),
            ContentMatcher::Regex(re) => re.is_match(line),
        }
    }
}

/// True when `commit` added or removed a line matching `matcher` — git's `-G`.
///
/// Compared against the FIRST parent only, matching git's default `-G`
/// behaviour on merges; a root commit is compared against an empty tree.
/// `path` restricts the diff via pathspec when a path filter is active, so
/// content and path intersect rather than union.
fn commit_diff_matches_content(
    repo: &git2::Repository,
    commit: &git2::Commit<'_>,
    matcher: &ContentMatcher,
    path: Option<&std::path::Path>,
) -> AppResult<bool> {
    let commit_tree = commit.tree()?;
    let parent_tree = match commit.parent(0) {
        Ok(p) => Some(p.tree()?),
        Err(_) => None,
    };

    let mut opts = git2::DiffOptions::new();
    if let Some(p) = path {
        opts.pathspec(p);
    }
    let diff = repo.diff_tree_to_tree(
        parent_tree.as_ref(),
        Some(&commit_tree),
        Some(&mut opts),
    )?;

    let mut hit = false;
    diff.foreach(
        &mut |_, _| true,
        None,
        None,
        Some(&mut |_delta, _hunk, line| {
            // Added / removed lines only — context lines were not touched.
            if matches!(line.origin(), '+' | '-') {
                if let Ok(text) = std::str::from_utf8(line.content()) {
                    if matcher.is_match(text) {
                        hit = true;
                    }
                }
            }
            // Keep walking: `foreach` has no early exit, and a short-circuit
            // via `false` would abort the whole diff as an error.
            true
        }),
    )?;
    Ok(hit)
}
```

- [ ] **Step 5: Wire it into `log_filtered_page`**

In `log_filtered_page`, after the `path_q` normalization (`:1336-1341`) and **before** `self.with_repo(…)`, compile the matcher once:

```rust
        // Compiled once, before any walking: a malformed pattern must fail
        // immediately, not per commit.
        let content_m = match filter
            .content
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => None,
            Some(pat) if filter.content_regex => Some(ContentMatcher::Regex(
                regex::Regex::new(pat)
                    .map_err(|e| AppError::InvalidArgument(format!("invalid regex: {e}")))?,
            )),
            Some(pat) => Some(ContentMatcher::Literal(pat.to_string())),
        };
```

Then inside the walk, **after** the existing path check (`:1406-1410`) and before the ref collection:

```rust
                // content — the only filter that costs a diff per commit, so it
                // runs last: an author- or path-scoped search only diffs the
                // commits everything else already accepted.
                if let Some(ref m) = content_m {
                    if !commit_diff_matches_content(repo, &commit, m, path_q.as_deref())? {
                        continue;
                    }
                }
```

- [ ] **Step 6: Run the tests**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test log_filter 2>&1 | tail -25
```
Expected: five new tests pass, existing `log_filter` and `log_pagination` tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/git/types.rs src-tauri/src/git/libgit2.rs src-tauri/tests/log_filter.rs
git commit -m "feat(log): content search over added/removed lines (#61 D10)

Implements git's -G semantics — the pattern appears in a line the commit
touched — not -S, which would need whole-blob occurrence counting on both
sides of every candidate.

Why: the predicate runs last in the walk because it is the only filter
costing a diff per commit, and the regex compiles once before walking so a
bad pattern fails immediately rather than per commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: D10 frontend — qualifier, types and the advanced panel field

**Files:**
- Modify: `src/lib/types.ts` (`LogFilter`)
- Modify: `src/features/commits/logFilter.ts` (`parseQueryText`, `LogFilterInputs`, `buildLogFilter`, `normalizeFilter`)
- Modify: `src/screens/History.tsx:96-110` (filter state), `:391` (panel props), `:1063` (`AdvancedSearchPanel`)
- Test: `src/features/commits/logFilter.test.ts` (append)

**Interfaces:**
- Consumes: the Rust fields from Task 6, as `content?: string` and `contentRegex?: boolean` (serde renames to camelCase across IPC — match how `shaPrefix` is already spelled in `src/lib/types.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `src/features/commits/logFilter.test.ts`:

```typescript
describe("content qualifier", () => {
  it("parses content: into the content field", () => {
    expect(parseQueryText("content:foo")).toEqual({ content: "foo" });
  });

  it("accepts contains: as an alias", () => {
    expect(parseQueryText("contains:foo")).toEqual({ content: "foo" });
  });

  it("leaves other text as a message term", () => {
    expect(parseQueryText("content:foo bar")).toEqual({
      content: "foo",
      message: "bar",
    });
  });

  it("normalizeFilter drops a blank content and a dangling regex toggle", () => {
    expect(normalizeFilter({ content: "   ", contentRegex: true })).toEqual({});
  });

  it("normalizeFilter keeps contentRegex only alongside a content term", () => {
    expect(normalizeFilter({ content: "foo", contentRegex: true })).toEqual({
      content: "foo",
      contentRegex: true,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/logFilter.test.ts 2>&1 | tail -20
```
Expected: FAIL — `content` is not produced.

- [ ] **Step 3: Extend the TS type**

In `src/lib/types.ts`, in `LogFilter`:

```typescript
  /** Pattern appearing in a line the commit added or removed (git `-G`). */
  content?: string;
  /** Treat `content` as a regular expression. */
  contentRegex?: boolean;
```

- [ ] **Step 4: Extend the parser and builder**

In `src/features/commits/logFilter.ts`, add to the `switch` in `parseQueryText`:

```typescript
      case "content":
      case "contains":
        if (value) out.content = value;
        break;
```

Add to `LogFilterInputs`:

```typescript
  /** Advanced-panel "changed lines contain" field. */
  content?: string;
  /** Advanced-panel regex toggle for `content`. */
  contentRegex?: boolean;
```

In `buildLogFilter`, before `return normalizeFilter(filter)`:

```typescript
  const content = inputs.content?.trim();
  if (content) filter.content = content;
  if (inputs.contentRegex) filter.contentRegex = true;
```

In `normalizeFilter`, alongside the other fields:

```typescript
  if (filter.content?.trim()) {
    out.content = filter.content.trim();
    // The toggle only means something with a pattern — a dangling regex flag
    // would make an otherwise-empty filter look set.
    if (filter.contentRegex) out.contentRegex = true;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/logFilter.test.ts 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 6: Add the advanced-panel field**

In `src/screens/History.tsx`: add state beside the existing `authorQ`/`pathQ` state (`:96-110`), pass it into `buildLogFilter`, thread it through `AdvancedSearchPanel`'s props (`:1063`), and render after the `Path` field:

```tsx
      <SearchField label="Changed lines contain">
        <PGInput
          value={contentQ}
          onChange={onContentQ}
          placeholder="needle"
          icon="search"
          size="sm"
          mono
          style={{ width: 220 }}
        />
      </SearchField>
      <SearchField label="Regex">
        <PGButton
          size="sm"
          aria-pressed={contentRegex}
          onClick={() => onContentRegex(!contentRegex)}
          style={contentRegex ? { color: "var(--accent)" } : undefined}
        >
          .*
        </PGButton>
      </SearchField>
```

The label is "Changed lines contain", not "pickaxe" — the semantics are `-G` and the UI must not oversell them.

- [ ] **Step 7: Verify the type-check and full unit suite**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit && pnpm test 2>&1 | tail -20
```
Expected: clean type-check, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/features/commits/logFilter.ts src/features/commits/logFilter.test.ts src/screens/History.tsx
git commit -m "feat(log): content: qualifier and advanced-panel content field (#61 D10)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: B6 — the `PGSkeleton` primitive

**Files:**
- Create: `src/design/skeleton.tsx`
- Modify: `src/design/index.ts` (barrel)
- Modify: `src/index.css:252-259` (reduced-motion guard)
- Test: `src/design/skeleton.test.tsx`

**Interfaces:**
- Produces: `PGSkeleton({ width, height, radius, count, gap, rowStep, style })` — presentational only, no loading logic. `rowStep: true` sizes the block as a density-aware list row.

- [ ] **Step 1: Write the failing test**

Create `src/design/skeleton.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGSkeleton } from "./skeleton";

describe("PGSkeleton", () => {
  it("renders one placeholder by default", () => {
    render(<PGSkeleton />);
    expect(screen.getAllByTestId("pg-skeleton")).toHaveLength(1);
  });

  it("renders `count` placeholders", () => {
    render(<PGSkeleton count={5} />);
    expect(screen.getAllByTestId("pg-skeleton")).toHaveLength(5);
  });

  it("is hidden from assistive tech", () => {
    render(<PGSkeleton />);
    expect(screen.getByTestId("pg-skeleton")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("sizes rows with the shared row token when rowStep is set", () => {
    render(<PGSkeleton rowStep />);
    expect(screen.getByTestId("pg-skeleton").style.height).toContain(
      "var(--row-h)",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/skeleton.test.tsx 2>&1 | tail -20
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the primitive**

Create `src/design/skeleton.tsx`:

```tsx
import * as React from "react";

export interface PGSkeletonProps {
  /** CSS width. Defaults to filling the container. */
  width?: number | string;
  /** CSS height, ignored when `rowStep` is set. */
  height?: number | string;
  /** Corner radius. */
  radius?: number;
  /** How many stacked placeholders to render. */
  count?: number;
  /** Gap between stacked placeholders. */
  gap?: number;
  /**
   * Size each placeholder as a plain list row honouring the UI-density
   * setting. A skeleton row that ignores density is a different height from
   * the real row it stands in for, so the list visibly jumps when data
   * arrives. `--row-h` is already `calc(24px + var(--row-step))`, so it is
   * used directly — adding `var(--row-step)` on top double-counts density.
   */
  rowStep?: boolean;
  style?: React.CSSProperties;
}

/**
 * Shimmering placeholder blocks for content that is loading.
 *
 * Presentational only — callers decide when to show it. Uses the `.pg-shimmer`
 * keyframe from index.css, which is suppressed under
 * `prefers-reduced-motion: reduce`.
 */
export function PGSkeleton({
  width = "100%",
  height = 12,
  radius = 3,
  count = 1,
  gap = 6,
  rowStep = false,
  style,
}: PGSkeletonProps) {
  // --row-h is already calc(24px + var(--row-step)) in index.css, so it is
  // used as-is; re-adding the step would double-count density.
  const blockHeight = rowStep ? "var(--row-h)" : height;

  const blocks = Array.from({ length: Math.max(1, count) }, (_, i) => (
    <div
      key={i}
      data-testid="pg-skeleton"
      aria-hidden="true"
      className="pg-shimmer"
      style={{
        width,
        height: blockHeight,
        borderRadius: radius,
        flexShrink: 0,
        ...style,
      }}
    />
  ));

  if (count <= 1) return blocks[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {blocks}
    </div>
  );
}
```

- [ ] **Step 4: Export from the barrel and guard reduced motion**

In `src/design/index.ts`, beside the other exports:

```typescript
export * from "./skeleton";
```

In `src/index.css`, after the existing `.pg-shimmer` rule (`:256-259`):

```css
@media (prefers-reduced-motion: reduce) {
  .pg-shimmer {
    animation: none;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/skeleton.test.tsx 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/design/skeleton.tsx src/design/skeleton.test.tsx src/design/index.ts src/index.css
git commit -m "feat(design): PGSkeleton primitive on the pg-shimmer keyframe (#61 B6)

Why: .pg-shimmer has been defined and unused since it was written. rowStep
sizes placeholders with var(--row-step) so a skeleton row matches the real
row height under any density setting instead of making the list jump.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: B6 — apply skeletons at the three load sites

**Files:**
- Modify: `src/features/diff/CommitDiffPanel.tsx:112-119` (spinner → skeleton)
- Modify: `src/screens/History.tsx` (commit-list initial load)
- Modify: `src/screens/RepoBrowser.tsx` (file preview load)
- Test: `src/features/diff/CommitDiffPanel.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `PGSkeleton` from Task 8.

- [ ] **Step 1: Write the failing test**

Create or append to `src/features/diff/CommitDiffPanel.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitDiffPanel } from "./CommitDiffPanel";

describe("CommitDiffPanel loading state", () => {
  it("shows skeleton placeholders while loading", () => {
    render(
      <CommitDiffPanel loading diffs={[]} error={null} />,
    );
    expect(screen.getAllByTestId("pg-skeleton").length).toBeGreaterThan(0);
  });

  it("shows no placeholders once loaded", () => {
    render(
      <CommitDiffPanel loading={false} diffs={[]} error={null} />,
    );
    expect(screen.queryAllByTestId("pg-skeleton")).toHaveLength(0);
  });
});
```

> Fill in `CommitDiffPanel`'s remaining required props from its own prop type (`CommitDiffPanel.tsx:10`) — pass the minimum the component needs to render, matching how the nearest existing component test constructs props.

- [ ] **Step 2: Run to verify failure**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/diff/CommitDiffPanel.test.tsx 2>&1 | tail -20
```
Expected: FAIL — no elements with that testid (a `PGSpinner` renders instead).

- [ ] **Step 3: Swap the three loading states**

In `CommitDiffPanel.tsx`, replace the `PGSpinner` inside the `loading &&` branch (`:112-119`) with a stack of file-row-shaped placeholders:

```tsx
          {loading && (
            <div style={{ padding: 12 }}>
              <PGSkeleton count={6} rowStep />
            </div>
          )}
```

Drop the now-unused `PGSpinner` import if nothing else in the file uses it.

In `History.tsx`, where the commit list renders its initial-load spinner, use `<PGSkeleton count={12} rowStep />`. Only for the **initial** load — a page-append must not blank the list the user is reading.

In `RepoBrowser.tsx`, where the file preview renders its loading spinner, use `<PGSkeleton count={14} height={10} />` — code lines, not list rows, so no `rowStep` here (`--lh-code` owns diff/code geometry and must not be mixed with row density).

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test 2>&1 | tail -20 && pnpm tsc --noEmit
```
Expected: all tests pass, type-check clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/CommitDiffPanel.tsx src/features/diff/CommitDiffPanel.test.tsx src/screens/History.tsx src/screens/RepoBrowser.tsx
git commit -m "feat(ui): skeleton loaders for log, commit diff and file preview (#61 B6)

Why: History uses skeletons for the initial load only — blanking the list
on a page-append would yank content the user is already reading. The file
preview sizes by code-line height, not row density: --lh-code owns that
geometry.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Full gate and PR

**Files:** none — verification only.

- [ ] **Step 1: Run every non-e2e gate**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit \
  && pnpm exec tsc -p e2e/tsconfig.json --noEmit \
  && pnpm test \
  && cargo test --manifest-path src-tauri/Cargo.toml \
  && pnpm vite build
```
Expected: all five clean. Do not proceed on a failure — fix it and re-run.

- [ ] **Step 2: Rebuild the e2e snapshot and run only the affected specs**

`src/` and `src-tauri/` both changed, so the snapshot must be rebuilt or the run silently tests the old binary. Affected surfaces: History (log filter + skeletons), Branches (upstream).

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/history-ops.e2e.ts --spec e2e/specs/branches.e2e.ts
```

Substitute the real spec filenames from `ls e2e/specs/` if these differ. Docker only — never a native run.

- [ ] **Step 3: Squash to one commit and open the PR**

```bash
git fetch origin && git rebase origin/main
git reset --soft origin/main
git commit -F - <<'MSG'
feat(ux): issue #61 Tier 2 pt 1 — upstream, content search, skeletons

D9: set_upstream backend op plus UI in the Branches inspector and branch
context menu; first push of an untracked branch now passes -u.
D10: LogFilter gains content/contentRegex, evaluated last in the paginated
walk with git's -G semantics; `content:`/`contains:` qualifier and an
advanced-panel field.
B6: PGSkeleton primitive on the previously-dead .pg-shimmer keyframe,
applied to the log, commit diff and file preview loads.

Why -G and not -S: true -S needs whole-blob occurrence counting on both
sides of every candidate commit; -G is what "find the commit that touched
this text" means in practice, and the UI is labelled accordingly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git push -u origin HEAD
gh pr create --fill
```

- [ ] **Step 4: Report**

State what passed, what the e2e run covered, and the PR URL.

---

## Self-review notes

**Spec coverage.** D9 → Tasks 2-5 (backend, wiring, UI, push `-u`). D10 → Tasks 6-7 (backend predicate + frontend qualifier/panel), including the `InvalidArgument` variant from Task 1, `-G` semantics, evaluation order, one-time regex compilation, and the honest UI label. B6 → Tasks 8-9 (primitive with density + reduced-motion constraints, applied at all three named load sites). The spec's testing table rows for this PR are covered by Tasks 2, 5, 6, 7, 8, 9 and the gate in Task 10.

**Deliberately deferred to PR 2/3:** D7, D8 (PR 2), D5, D6 (PR 3). `AppError::InvalidArgument` lands here because D10 needs it first; D7 reuses it.

**Known follow-through:** Tasks 4 and 9 both say to match the nearest existing test's prop/state setup rather than inventing one, because the exact seeding those two screens need is a detail of code the implementer will have open. Every other step carries its literal content.
