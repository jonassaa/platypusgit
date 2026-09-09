# Commit menu parity — PR1: the history-rewriting entries

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add *Edit commit message…*, *Drop this commit* and *Undo this commit…*
to the History commit context menu, behind a shared warning that names the
force-push when the commit is already published.

**Architecture:** Each entry's flow lives in its own `features/commits/` module
and the menu entry is a few lines that call it — the shape `buildRebasePlan` /
`runRebasePlan` / `squashMessage` already have. Rewording an *older* commit
reuses the rebase engine's existing `Reword` action through a new
`buildRebasePlan` mode; rewording **HEAD** takes a new message-only amend
backend op, because the rebase engine refuses a dirty worktree.

**Tech Stack:** Tauri 2 / Rust (git2), React 19 / TypeScript, Zustand, vitest,
`cargo test`.

**Spec:** `docs/superpowers/specs/2026-09-08-commit-menu-parity-spec.md` — read
it first; this plan argues from it and does not repeat its reasoning.

## Global Constraints

- **Node 22 + pnpm**, Rust stable. This session's shell does not inherit the
  interactive rc, and the worktree guard refuses the `export PATH="$HOME/…"`
  line from CLAUDE.md — invoke tools by absolute path instead:
  `~/Library/pnpm/pnpm`, `~/.cargo/bin/cargo`.
- **The worktree guard also refuses compound shell commands containing a `git`
  token** (`libgit2.rs`, `.github/`, `pgit`). Run those as plain, separate
  commands.
- **Every IPC-crossing fn returns `AppResult<T>`.** No new `AppError` variant in
  this PR — the HEAD-moved refusal reuses `InvalidArgument(String)`, which
  already carries a message and already has `appErrorDetail` prose. Adding a
  variant would require the TS union and `appErrorDetail` in the same commit
  (`test/appErrors.test.ts` fails the build otherwise), and this refusal does not
  need its own remedy surface.
- **Never `Command::new` outside `src-tauri/src/proc.rs`** — a guard test fails
  the build. Nothing in this PR spawns a process.
- **`git2::Repository` is `Send` not `Sync`.** Wrap git2 work in
  `spawn_blocking`; use `with_repo` (the exclusive/write path), and **verify and
  mutate under ONE lock acquisition** — the amend's HEAD check and the amend
  itself go in the same `with_repo` closure.
- **A new command must be added to `docs/dev/architecture.md` in the same
  commit** or `test/docs.test.ts` fails the build.
- **No native `<select>`, no `window.confirm`/`prompt`** — `pgConfirm` /
  `pgPrompt` from `@/design`; a dismissal is "no answer", never a choice.
- **Menu building stays synchronous and allocation-cheap.** It runs on every
  right-click. Every `await` in this PR happens inside an `onClick`.
- Commit style: `feat(scope): …` / `fix(scope): …` / `test: …` / `docs: …`,
  imperative subject under 72 chars, optional body with **Why:**, trailing
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `fullCommitMessage` — one owner for "this commit's message as text"

`combinedSquashMessage` (`src/features/commits/squashMessage.ts`) already renders
`summary\n\nbody` per commit. The reword prompt needs exactly that for one
commit, so the single-commit case is extracted and the squash helper is rewritten
to call it. Two renderers of a commit message would drift.

**Files:**
- Create: `src/features/commits/commitMessageText.ts`
- Create: `src/features/commits/commitMessageText.test.ts`
- Modify: `src/features/commits/squashMessage.ts`

**Interfaces:**
- Consumes: `CommitInfo` from `@/lib/types` (`summary: string`, `body: string | null`).
- Produces: `fullCommitMessage(commit: Pick<CommitInfo, "summary" | "body">): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/commits/commitMessageText.test.ts
import { describe, expect, it } from "vitest";
import { fullCommitMessage } from "./commitMessageText";

describe("fullCommitMessage", () => {
  it("joins summary and body with a blank line", () => {
    expect(fullCommitMessage({ summary: "feat: x", body: "Why: y" })).toBe(
      "feat: x\n\nWhy: y",
    );
  });

  it("is the summary alone when there is no body", () => {
    expect(fullCommitMessage({ summary: "feat: x", body: null })).toBe("feat: x");
  });

  it("treats a whitespace-only body as no body", () => {
    expect(fullCommitMessage({ summary: "feat: x", body: "  \n\n " })).toBe("feat: x");
  });

  it("trims trailing whitespace off the body but keeps its internal blank lines", () => {
    expect(
      fullCommitMessage({ summary: "s", body: "one\n\ntwo\n\n" }),
    ).toBe("s\n\none\n\ntwo");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/commitMessageText.test.ts`
Expected: FAIL — cannot resolve `./commitMessageText`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/commits/commitMessageText.ts
import type { CommitInfo } from "@/lib/types";

/**
 * One commit's message as editable text: `summary`, then its body after a blank
 * line. The same starting point `git rebase -i` hands you in an editor, minus
 * the comment lines.
 *
 * The single owner of that rendering — `combinedSquashMessage` calls it per
 * commit, and the reword prompt calls it for one. A whitespace-only body is
 * treated as absent rather than rendered as trailing blanks, because the value
 * goes straight into a prompt the user then edits.
 */
export function fullCommitMessage(
  commit: Pick<CommitInfo, "summary" | "body">,
): string {
  const body = commit.body?.trim();
  return body ? `${commit.summary}\n\n${body}` : commit.summary;
}
```

- [ ] **Step 4: Rewrite `combinedSquashMessage` to call it**

In `src/features/commits/squashMessage.ts`, replace the loop body so the
rendering lives in one place:

```ts
import type { CommitInfo } from "@/lib/types";
import { fullCommitMessage } from "./commitMessageText";

export function combinedSquashMessage(
  oids: readonly string[],
  byOid: ReadonlyMap<string, CommitInfo>,
): string {
  const parts: string[] = [];
  for (const oid of oids) {
    const c = byOid.get(oid);
    if (!c) continue;
    parts.push(fullCommitMessage(c));
  }
  return parts.join("\n\n");
}
```

- [ ] **Step 5: Run both suites and confirm green**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/commitMessageText.test.ts src/features/commits/squashMessage.test.ts`
Expected: PASS, including every pre-existing `squashMessage` assertion — the
extraction must be behaviour-preserving.

- [ ] **Step 6: Commit**

```
test(commits): pin a commit's message-as-text and reuse it for squash
```

---

### Task 2: `buildRebasePlan` gains `reword` and `drop` modes

**Files:**
- Modify: `src/features/commits/buildRebasePlan.ts`
- Modify: `src/features/commits/buildRebasePlan.test.ts`

**Interfaces:**
- Produces: two new `mode` shapes on the existing `buildRebasePlan(commits, fromOid, mode)`:
  - `{ kind: "reword"; targetOid: string; message: string }`
  - `{ kind: "drop"; targetOid: string }`

  Callers pass the target's **first parent** as `fromOid`, so the target is
  inside the plan. Return type is unchanged: `RebaseStep[] | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/commits/buildRebasePlan.test.ts`. Match the existing
file's fixture style — read the top of it first and reuse its commit factory
rather than inventing a second one.

```ts
describe("reword mode", () => {
  it("marks only the target Reword and carries its message", () => {
    // c3 <- c2 <- c1 (newest first), reword c2 with base c1
    const commits = [commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])];
    const plan = buildRebasePlan(commits, "c1", {
      kind: "reword",
      targetOid: "c2",
      message: "new subject",
    });
    expect(plan).toEqual([
      { oid: "c2", action: "Reword", message: "new subject" },
      { oid: "c3", action: "Pick", message: null },
    ]);
  });

  it("still drops a merge commit it replays over", () => {
    const commits = [commit("m", ["c2", "side"]), commit("c2", ["c1"]), commit("c1", [])];
    const plan = buildRebasePlan(commits, "c1", {
      kind: "reword",
      targetOid: "c2",
      message: "new",
    });
    expect(plan).toEqual([
      { oid: "c2", action: "Reword", message: "new" },
      { oid: "m", action: "Drop", message: null },
    ]);
  });

  it("returns null when the base is outside the loaded range", () => {
    const commits = [commit("c2", ["c1"]), commit("c1", [])];
    expect(
      buildRebasePlan(commits, "nope", { kind: "reword", targetOid: "c2", message: "x" }),
    ).toBeNull();
  });
});

describe("drop mode", () => {
  it("marks only the target Drop and leaves newer commits picked", () => {
    const commits = [commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])];
    expect(buildRebasePlan(commits, "c1", { kind: "drop", targetOid: "c2" })).toEqual([
      { oid: "c2", action: "Drop", message: null },
      { oid: "c3", action: "Pick", message: null },
    ]);
  });

  it("carries no message on the dropped step", () => {
    const commits = [commit("c2", ["c1"]), commit("c1", [])];
    const plan = buildRebasePlan(commits, "c1", { kind: "drop", targetOid: "c2" });
    expect(plan?.[0].message).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/buildRebasePlan.test.ts`
Expected: FAIL — TypeScript rejects the new `mode` shapes, and the `reword`/
`drop` steps come back as `Pick`.

- [ ] **Step 3: Extend the mode union and the doc comment**

In `buildRebasePlan.ts`, add to the `mode` parameter union:

```ts
    | { kind: "reword"; targetOid: string; message: string }
    | { kind: "drop"; targetOid: string }
```

and to the doc comment's `mode` list, above the merge paragraph:

```
 *   - { kind: "reword", targetOid, message }: target becomes "Reword" carrying
 *     the new message. Base is the target's first parent, so the target is
 *     inside the plan.
 *   - { kind: "drop", targetOid }: target becomes "Drop"; everything newer stays
 *     a pick and replays onto the target's parent.
```

- [ ] **Step 4: Add the two arms**

In the `oldestFirst.map` callback, after the existing `fixup` arm and before the
`squash` arm — order does not matter functionally, but keep the arms in the same
order as the union so a reader can check coverage at a glance:

```ts
    } else if (mode.kind === "reword" && c.oid === mode.targetOid) {
      action = "Reword";
      message = mode.message;
    } else if (mode.kind === "drop" && c.oid === mode.targetOid) {
      action = "Drop";
```

The merge check stays FIRST in the chain, so a merge is still emitted as `Drop`
whatever the mode asks — that is git's own default and the backend refuses
anything else on a merge.

- [ ] **Step 5: Run and confirm green**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/buildRebasePlan.test.ts src/features/commits/buildRebasePlan.merge.test.ts`
Expected: PASS, new and pre-existing.

- [ ] **Step 6: Commit**

```
feat(rebase): build reword and drop plans from one commit
```

---

### Task 3: the message-only amend backend op

The op the HEAD reword path needs. `commit.amend` with `tree: None` reuses the
commit's original tree, which is `git commit --amend --only -m`: it ignores the
index, so it works with a dirty worktree and cannot fold in staged changes.

**Files:**
- Modify: `src-tauri/src/git/mod.rs` (the `// === commit ===` block, after `fn commit`)
- Modify: `src-tauri/src/git/libgit2.rs` (beside the `fn commit` impl)
- Modify: `src-tauri/src/git/cli.rs` (stub beside `fn commit`)
- Modify: `src-tauri/src/commands/commits.rs` (after `pub async fn commit`)
- Modify: `src-tauri/src/lib.rs` (`invoke_handler![…]`, beside `commands::commits::commit`)
- Modify: `docs/dev/architecture.md` (the `commands/commits.rs` entry — same commit, or the docs test fails)
- Create: `src-tauri/tests/amend_message.rs`

**Interfaces:**
- Produces:
  - Trait: `fn amend_head_message(&self, repo_id: &RepoId, expected_oid: &str, message: &str, no_verify: bool) -> AppResult<CommitResult>`
  - Command: `amend_head_message(repo_id: String, expected_oid: String, message: String, no_verify: Option<bool>) -> AppResult<CommitResult>`
  - `CommitResult` is the existing type `fn commit` already returns — reused, not redefined.

- [ ] **Step 1: Write the failing Rust tests**

```rust
// src-tauri/tests/amend_message.rs
mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

/// The whole point of the op: the message changes, the tree does not.
#[test]
fn amend_changes_the_message_and_keeps_the_tree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let before = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let tree_before = before.tree_id();
    let author_before = before.author().when().seconds();

    let out = backend
        .amend_head_message(&handle.id, &before.id().to_string(), "reworded", false)
        .expect("amend");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.message().unwrap(), "reworded");
    assert_eq!(after.tree_id(), tree_before, "tree must be untouched");
    assert_ne!(after.id(), before.id(), "a reworded commit is a new object");
    assert_eq!(out.oid, after.id().to_string());
    // Author is preserved; only the committer is refreshed, as git does.
    assert_eq!(after.author().when().seconds(), author_before);
    assert_eq!(after.parent_count(), before.parent_count());
}

/// The reason the op takes `expected_oid` at all: HEAD can move between the
/// menu opening and the click landing.
#[test]
fn amend_refuses_when_head_has_moved() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let stale = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    tr.add_commit("other.txt", "x\n", "a second commit");

    let err = backend
        .amend_head_message(&handle.id, &stale, "reworded", false)
        .expect_err("must refuse a stale oid");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");

    // And it changed nothing.
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.message().unwrap(), "a second commit");
}

/// A dirty worktree is exactly the case the rebase engine cannot serve, so this
/// op must serve it — and must leave the dirt alone.
#[test]
fn amend_works_with_a_dirty_worktree_and_does_not_consume_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello, edited\n");
    write_file(tr.path(), "untracked.txt", "new\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let tree_before = head.tree_id();

    backend
        .amend_head_message(&handle.id, &head.id().to_string(), "reworded", false)
        .expect("amend with a dirty worktree");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.message().unwrap(), "reworded");
    assert_eq!(after.tree_id(), tree_before, "the edit must NOT be committed");
    assert_eq!(
        support::fs::read_file(tr.path(), "README.md"),
        "hello, edited\n",
        "the working tree must be left as it was"
    );
}

/// The index is the other half of that guarantee: `commit(amend: true)` writes
/// the index tree, and this op must not.
#[test]
fn amend_ignores_staged_changes() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "staged.txt", "staged\n");
    {
        let mut index = tr.repo.index().unwrap();
        index.add_path(std::path::Path::new("staged.txt")).unwrap();
        index.write().unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();

    backend
        .amend_head_message(&handle.id, &head.id().to_string(), "reworded", false)
        .expect("amend");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.tree_id(), head.tree_id());
    assert!(
        after.tree().unwrap().get_name("staged.txt").is_none(),
        "the staged file must not be in the reworded commit"
    );
    // Still staged afterwards.
    let idx = tr.repo.index().unwrap();
    assert!(idx.get_path(std::path::Path::new("staged.txt"), 0).is_some());
}

/// An empty message is refused on this side of the IPC boundary, as `commit` does.
#[test]
fn amend_refuses_an_empty_message() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    let err = backend
        .amend_head_message(&handle.id, &head, "   \n ", false)
        .expect_err("must refuse");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
}

/// An unborn HEAD has no commit to reword.
#[test]
fn amend_refuses_on_an_unborn_head() {
    let tr = TempRepo::fresh();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .amend_head_message(&handle.id, "0000000", "x", false)
        .expect_err("must refuse");
    assert!(
        matches!(err, AppError::Unborn | AppError::InvalidArgument(_)),
        "got {err:?}"
    );
}
```

- [ ] **Step 2: Run and confirm they fail**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --test amend_message`
Expected: FAIL to compile — `amend_head_message` is not a method on `GitBackend`.

- [ ] **Step 3: Add the trait method**

In `src-tauri/src/git/mod.rs`, in the `// === commit ===` block right after
`fn commit`:

```rust
    /// Replace HEAD's commit message and nothing else.
    ///
    /// `git commit --amend --only -m <msg>`: `tree: None` on `Commit::amend`
    /// reuses the commit's ORIGINAL tree, so the index is not read and a dirty
    /// worktree is fine. That is the difference from `commit(amend: true)`,
    /// which writes the index tree and would fold staged changes into the
    /// commit being reworded.
    ///
    /// `expected_oid` is what the caller believed HEAD was. HEAD can move
    /// between a context menu opening and its click landing, so the check and
    /// the amend happen under ONE lock acquisition; a mismatch refuses and
    /// writes nothing.
    fn amend_head_message(
        &self,
        repo_id: &RepoId,
        expected_oid: &str,
        message: &str,
        no_verify: bool,
    ) -> AppResult<CommitResult>;
```

- [ ] **Step 4: Add the `CliBackend` stub**

In `src-tauri/src/git/cli.rs`, beside `fn commit`:

```rust
    fn amend_head_message(
        &self,
        _repo_id: &RepoId,
        _expected_oid: &str,
        _message: &str,
        _no_verify: bool,
    ) -> AppResult<CommitResult> {
        Err(AppError::NotImplemented)
    }
```

- [ ] **Step 5: Implement it in `Libgit2Backend`**

In `src-tauri/src/git/libgit2.rs`, directly after the `fn commit` impl. Read
`fn commit` first — this mirrors its hook and signing structure deliberately,
and the differences are the point.

```rust
    fn amend_head_message(
        &self,
        repo_id: &RepoId,
        expected_oid: &str,
        message: &str,
        no_verify: bool,
    ) -> AppResult<CommitResult> {
        use crate::git::hooks;
        use crate::git::signature::default_signature;

        // Refused HERE, before any hook runs, exactly as `commit` does: every
        // caller of this method meant to write history.
        if message.trim().is_empty() {
            return Err(AppError::InvalidArgument(
                "the commit message is empty".to_string(),
            ));
        }

        let repo_path = self.repo_path(repo_id)?;

        // `pre-commit` is deliberately NOT run: this op cannot change the tree
        // (see `tree: None` below), so a hook that lints content has nothing to
        // inspect. The MESSAGE hooks do run — a `commit-msg` that enforces a
        // format is exactly what should fire on a reword. A documented
        // deviation from `git commit --amend --only`, which runs all three.
        let message = if no_verify {
            message.to_string()
        } else {
            let git_dir = self.with_repo(repo_id, |repo| Ok(repo.path().to_path_buf()))?;
            let msg_path = git_dir.join("COMMIT_EDITMSG");
            std::fs::write(&msg_path, message).map_err(|e| AppError::Io(e.to_string()))?;
            let msg_arg = msg_path
                .to_str()
                .ok_or_else(|| AppError::InvalidPath(msg_path.display().to_string()))?;

            for (name, args) in [
                ("prepare-commit-msg", vec![msg_arg, "message"]),
                ("commit-msg", vec![msg_arg]),
            ] {
                let out = hooks::run_hook(&repo_path, name, &args)?;
                if out.rejected() {
                    return Err(AppError::HookRejected(crate::error::HookRejection {
                        hook: name.to_string(),
                        output: out.output,
                    }));
                }
            }

            // Either hook may have rewritten the file; what it left is what git
            // would commit.
            std::fs::read_to_string(&msg_path).map_err(|e| AppError::Io(e.to_string()))?
        };

        // ONE acquisition for verify-and-mutate. Splitting these is the stash
        // TOCTOU bug: HEAD could move between the check and the amend.
        let oid = self.with_repo(repo_id, |repo| {
            let head_ref = repo.head().map_err(|_| AppError::Unborn)?;
            let head = head_ref.peel_to_commit().map_err(|_| AppError::Unborn)?;
            if head.id().to_string() != expected_oid {
                return Err(AppError::InvalidArgument(format!(
                    "HEAD has moved since this commit was chosen — it is now {}, not {}",
                    &head.id().to_string()[..7.min(head.id().to_string().len())],
                    &expected_oid[..7.min(expected_oid.len())],
                )));
            }

            let sig = default_signature(repo)?;

            // The signing chain, so a signed commit stays signed (CLAUDE.md:
            // one signing chain for commits AND tags). `commit_signed` needs the
            // tree and the parents explicitly; both come from the commit being
            // reworded, which is what makes this message-only.
            if crate::git::signing::should_sign(repo, None)? {
                let tree = head.tree()?;
                return commit_signed(repo, &sig, &message, &tree, Some(&head_ref), true);
            }

            // Unsigned path. `tree: None` reuses the original tree; `author:
            // None` preserves the author. Only the committer is refreshed.
            let new_oid = head.amend(Some("HEAD"), None, Some(&sig), None, Some(&message), None)?;
            Ok(new_oid.to_string())
        })?;

        Ok(CommitResult { oid })
    }
```

**Before writing this, verify three things in the tree and adjust rather than
assume** — this plan was written from a read of `fn commit`, not from a compile:

1. `CommitResult`'s real fields (`grep -n "struct CommitResult" -A 10
   src-tauri/src/git/types.rs`). If it carries more than `oid`, fill the rest the
   way `fn commit` does.
2. Whether a `should_sign`-shaped helper exists. `fn commit` decides signing
   somewhere — find how (`grep -n "sign" src-tauri/src/git/libgit2.rs | sed -n
   '/fn commit/,$p'` around the commit impl, and read `git/signing.rs`). Reuse
   that decision function verbatim; do NOT re-derive the `commit.gpgsign` rule.
   If the helper takes different arguments, match them.
3. `commit_signed`'s signature (it is at `libgit2.rs:1415`) — it takes
   `head: Option<&git2::Reference>` and an `amend: bool`, and it already handles
   "an amend inherits HEAD's parents" plus the `commit (amend):` reflog message.

- [ ] **Step 6: Add the Tauri command**

In `src-tauri/src/commands/commits.rs`, after `pub async fn commit`:

```rust
/// Replace HEAD's commit message, leaving the tree and the index alone.
///
/// The reword path for HEAD. An older commit is reworded by the rebase engine
/// instead (`RebaseAction::Reword`) — but the engine refuses a dirty worktree,
/// and rewording the commit you are sitting on is the common case, so it gets a
/// path that does not need one.
#[tauri::command]
pub async fn amend_head_message(
    state: State<'_, AppState>,
    repo_id: String,
    // What the caller believed HEAD was; a mismatch refuses. See the trait doc.
    expected_oid: String,
    message: String,
    // Skip the message hooks for this reword only, matching `commit`'s option.
    no_verify: Option<bool>,
) -> AppResult<CommitResult> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let no_verify = no_verify.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        backend.amend_head_message(&repo_id, &expected_oid, &message, no_verify)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 7: Register it**

In `src-tauri/src/lib.rs`, in `invoke_handler![…]`, on the line after
`commands::commits::commit,`:

```rust
            commands::commits::amend_head_message,
```

- [ ] **Step 8: Document it — same commit**

In `docs/dev/architecture.md`, find the `commands/commits.rs` entry in the
backend tree and add `amend_head_message` to its command list, with a clause
saying it is message-only and why HEAD has its own path. `test/docs.test.ts`
fails the build if a registered command appears in no doc.

- [ ] **Step 9: Run the Rust tests**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --test amend_message`
Expected: PASS, all six.

Then the whole backend suite, because a new trait method touches every
implementor:
Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS. Do not `cargo fmt` — CI runs no fmt/clippy gate and the crate is
already broadly unformatted, so a formatted focused diff becomes unreviewable.

- [ ] **Step 10: Prove the TOCTOU guard actually guards**

A passing check proves little until you have watched it fail. Temporarily delete
the `head.id().to_string() != expected_oid` block, re-run
`amend_refuses_when_head_has_moved`, and confirm it FAILS. Restore the block and
confirm it passes again. Note in the test file which test catches the removal.

- [ ] **Step 11: Commit**

```
feat(commits): amend HEAD's message without touching the tree
```

---

### Task 4: TS wrapper and store action

**Files:**
- Modify: `src/lib/tauri.ts` (after `export async function commit`)
- Modify: `src/features/repo/useRepoStore.ts` (the `RepoStore` interface + the action, beside `commit`)
- Create: `src/features/repo/useRepoStore.amendMessage.test.ts`

**Interfaces:**
- Produces:
  - `amendHeadMessage(repoId: string, expectedOid: string, message: string, noVerify?: boolean): Promise<CommitResult>`
  - store action `amendMessage(expectedOid: string, message: string): Promise<boolean>` — `true` when the message was rewritten.

- [ ] **Step 1: Write the failing store test**

Read `src/features/repo/useRepoStore.*.test.ts` for the house mocking pattern
(`mockInvoke`, `getInvokeCalls`) and follow it — do not invent a second one.

```ts
// src/features/repo/useRepoStore.amendMessage.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useRepoStore } from "./useRepoStore";
// ...plus the same test setup imports the sibling store tests use.

describe("amendMessage", () => {
  beforeEach(() => {
    // ...reset the store and the invoke mock exactly as the sibling tests do.
  });

  it("sends the expected oid so a moved HEAD is refused by the backend", async () => {
    mockInvoke("amend_head_message", () => ({ oid: "new1234" }));
    await useRepoStore.getState().amendMessage("old1234", "reworded");
    const call = getInvokeCalls().find((c) => c.cmd === "amend_head_message");
    expect(call?.args).toMatchObject({ expectedOid: "old1234", message: "reworded" });
  });

  it("refreshes the repo, so the log repaints with the new oid", async () => {
    mockInvoke("amend_head_message", () => ({ oid: "new1234" }));
    await useRepoStore.getState().amendMessage("old1234", "reworded");
    expect(getInvokeCalls().some((c) => c.cmd === "get_status")).toBe(true);
  });

  it("routes a hook refusal to hookRejection, not the error banner", async () => {
    mockInvoke("amend_head_message", () => {
      throw { kind: "HookRejected", message: { hook: "commit-msg", output: "nope" } };
    });
    const ok = await useRepoStore.getState().amendMessage("old1234", "bad");
    expect(ok).toBe(false);
    expect(useRepoStore.getState().hookRejection).toMatchObject({ hook: "commit-msg" });
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("puts a missing identity in noSignature, not the error banner", async () => {
    mockInvoke("amend_head_message", () => {
      throw { kind: "NoSignature" };
    });
    const ok = await useRepoStore.getState().amendMessage("old1234", "x");
    expect(ok).toBe(false);
    expect(useRepoStore.getState().noSignature).toBe(true);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("reports any other failure in the banner", async () => {
    mockInvoke("amend_head_message", () => {
      throw { kind: "InvalidArgument", message: "HEAD has moved" };
    });
    const ok = await useRepoStore.getState().amendMessage("old1234", "x");
    expect(ok).toBe(false);
    expect(useRepoStore.getState().error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `~/Library/pnpm/pnpm vitest run src/features/repo/useRepoStore.amendMessage.test.ts`
Expected: FAIL — `amendMessage` is not a function.

- [ ] **Step 3: Add the `lib/tauri.ts` wrapper**

Never call `invoke` directly from a feature; the typed wrapper is the boundary.

```ts
/**
 * Replace HEAD's commit message and nothing else — the reword path for the
 * commit you are sitting on.
 *
 * `expectedOid` is what the caller believed HEAD was. The backend refuses a
 * mismatch rather than rewording whatever happens to be there now: HEAD can
 * move between a context menu opening and its click landing.
 */
export async function amendHeadMessage(
  repoId: string,
  expectedOid: string,
  message: string,
  noVerify = false,
): Promise<CommitResult> {
  return invoke<CommitResult>("amend_head_message", {
    repoId,
    expectedOid,
    message,
    noVerify,
  });
}
```

- [ ] **Step 4: Add the store action**

Mirror `commit`'s catch arms — the same three failures need the same three
surfaces, and `refreshAll()` comes before `set({ error })` in every danger-op
catch arm. Add to the `RepoStore` interface beside `commit`:

```ts
  /**
   * Reword HEAD in place (message only). Resolves true when history changed.
   *
   * `expectedOid` guards against HEAD moving under the menu — see
   * `amendHeadMessage`.
   */
  amendMessage: (expectedOid: string, message: string) => Promise<boolean>;
```

and the implementation beside `async commit(`:

```ts
  async amendMessage(expectedOid, message) {
    const repo = get().current;
    if (!repo) return false;
    setFor(repo.id, { hookRejection: null, noSignature: false });
    const before = headSnapshot();
    try {
      await amendHeadMessageFn(repo.id, expectedOid, message);
      await get().refreshAll();
      // Undoable like any other history rewrite: before/after already
      // describes putting the original commit back.
      noteUndo(repo.id, "commit", "reword", before);
      return true;
    } catch (e) {
      if (isAppError(e) && e.kind === "HookRejected") {
        await get().refreshAll();
        setFor(repo.id, { hookRejection: e.message as HookRejection });
        return false;
      }
      if (isNoSignatureError(e)) {
        setFor(repo.id, { noSignature: true });
        return false;
      }
      setErrorFor(repo.id, e);
      return false;
    }
  },
```

Import it at the top of the store the way its siblings are imported —
`amendHeadMessage as amendHeadMessageFn`.

- [ ] **Step 5: Run the test and the type-check**

Run: `~/Library/pnpm/pnpm vitest run src/features/repo/useRepoStore.amendMessage.test.ts`
Expected: PASS.
Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```
feat(commits): wire the message-only amend through the repo store
```

---

### Task 5: the published-commit warning

**Files:**
- Create: `src/features/commits/rewriteWarning.ts`
- Create: `src/features/commits/rewriteWarning.test.ts`

**Interfaces:**
- Produces:
  - `isPublished(repoId: string, oid: string, upstream: string | null): Promise<boolean>`
  - `rewriteWarning(upstream: string | null, published: boolean): string | null` — the sentence, or null when there is nothing to warn about.
  - `confirmRewrite(opts: { title: string; body: string; confirmLabel: string; danger?: boolean; repoId: string; oid: string; upstream: string | null }): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/commits/rewriteWarning.test.ts
import { describe, expect, it } from "vitest";
import { rewriteWarning } from "./rewriteWarning";

describe("rewriteWarning", () => {
  it("names the upstream and the force-push when the commit is published", () => {
    expect(rewriteWarning("origin/main", true)).toBe(
      "This commit is already on origin/main. Rewriting it means your next push has to be forced.",
    );
  });

  it("is silent for an unpublished commit", () => {
    expect(rewriteWarning("origin/main", false)).toBeNull();
  });

  it("is silent when the branch tracks nothing — there is nothing to force", () => {
    expect(rewriteWarning(null, true)).toBeNull();
  });
});
```

Then the containment predicate, which is the part worth pinning because the
argument order of `ahead_behind` is easy to get backwards:

```ts
import { isPublished } from "./rewriteWarning";

describe("isPublished", () => {
  it("is true when the commit is contained in the upstream", async () => {
    // `behind` is what a has and b does not, so 0 means fully contained.
    mockInvoke("ahead_behind", () => ({ ahead: 3, behind: 0, mergeBase: "abc" }));
    expect(await isPublished("r1", "abc1234", "origin/main")).toBe(true);
  });

  it("is false when the commit is not in the upstream yet", async () => {
    mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 2, mergeBase: "abc" }));
    expect(await isPublished("r1", "abc1234", "origin/main")).toBe(false);
  });

  it("asks about the commit against the upstream, in that order", async () => {
    mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 0, mergeBase: null }));
    await isPublished("r1", "abc1234", "origin/main");
    const call = getInvokeCalls().find((c) => c.cmd === "ahead_behind");
    expect(call?.args).toMatchObject({ a: "abc1234", b: "origin/main" });
  });

  it("is false, not a throw, when the upstream cannot be resolved", async () => {
    mockInvoke("ahead_behind", () => {
      throw { kind: "InvalidRef", message: "no such ref" };
    });
    expect(await isPublished("r1", "abc1234", "origin/gone")).toBe(false);
  });

  it("does not ask at all when the branch tracks nothing", async () => {
    expect(await isPublished("r1", "abc1234", null)).toBe(false);
    expect(getInvokeCalls().some((c) => c.cmd === "ahead_behind")).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/rewriteWarning.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/commits/rewriteWarning.ts
import { pgConfirm } from "@/design";
import { aheadBehind } from "@/lib/tauri";
import type { CommitInfo } from "@/lib/types";

/**
 * Everything a rewrite flow reads, gathered by the CALLER.
 *
 * Shared vocabulary rather than any one flow's own type. Keeping the store reads
 * at the call site — where menu building already reads the store synchronously —
 * is what makes the flows unit-testable without mounting a store.
 */
export interface RewriteCtx {
  /** HEAD's ancestry, newest first — what a rebase plan is defined over. */
  commits: CommitInfo[];
  repoId: string;
  /** The current branch's upstream, for the published-commit warning. */
  upstream: string | null;
  headOid: string | null;
}

/**
 * Is this commit already contained in the branch's upstream?
 *
 * `ahead_behind(a, b).behind` is "what `a` has and `b` does not", so zero means
 * `a` is fully contained in `b` — the commit is published. One IPC call, made
 * from an `onClick` and never while building a menu.
 *
 * A branch that tracks nothing is not published and is not asked about. An
 * unresolvable upstream (a deleted remote branch, a stale config) answers
 * "false" rather than throwing: a warning is a courtesy, and failing to compute
 * one must never block the operation the user asked for.
 */
export async function isPublished(
  repoId: string,
  oid: string,
  upstream: string | null,
): Promise<boolean> {
  if (!upstream) return false;
  try {
    const ab = await aheadBehind(repoId, oid, upstream);
    return ab.behind === 0;
  } catch {
    return false;
  }
}

/** The sentence a rewrite confirm gains when the commit is already pushed. */
export function rewriteWarning(
  upstream: string | null,
  published: boolean,
): string | null {
  if (!upstream || !published) return null;
  return `This commit is already on ${upstream}. Rewriting it means your next push has to be forced.`;
}

/**
 * The one confirm every history-rewriting menu entry goes through, so all five
 * of them (reword, drop, undo, squash, fixup) say the same thing about a
 * published commit.
 *
 * No force-push is offered. A network write behind a menu item that does not
 * mention pushing is a surprise, and force-with-lease is its own design
 * question.
 */
export async function confirmRewrite(opts: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  repoId: string;
  oid: string;
  upstream: string | null;
}): Promise<boolean> {
  const warning = rewriteWarning(
    opts.upstream,
    await isPublished(opts.repoId, opts.oid, opts.upstream),
  );
  return pgConfirm({
    title: opts.title,
    body: warning ? `${opts.body}\n\n${warning}` : opts.body,
    confirmLabel: opts.confirmLabel,
    danger: opts.danger,
  });
}
```

Check `aheadBehind`'s real exported name and parameter names in
`src/lib/tauri.ts` before writing this, and match them.

- [ ] **Step 4: Run and confirm green**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/rewriteWarning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
feat(commits): warn once when a rewrite touches a published commit
```

---

### Task 6: the three flow modules

**Files:**
- Create: `src/features/commits/rewordCommit.ts` + `.test.ts`
- Create: `src/features/commits/dropCommit.ts` + `.test.ts`
- Create: `src/features/commits/undoCommit.ts` + `.test.ts`

**Interfaces:**
- Consumes: `fullCommitMessage` (Task 1), `buildRebasePlan`'s `reword`/`drop`
  modes (Task 2), `amendMessage` (Task 4), `confirmRewrite` (Task 5),
  `runRebasePlanNow` (existing).
- Produces:
  - `rewordCommit(target: { oid: string }, ctx: RewriteCtx): Promise<void>`
  - `dropCommit(target: { oid: string }, ctx: RewriteCtx): Promise<void>`
  - `undoCommit(target: { oid: string }, ctx: RewriteCtx): Promise<void>`
  - `interface RewriteCtx { commits: CommitInfo[]; repoId: string; upstream: string | null; headOid: string | null }`
    — declared in `rewriteWarning.ts` beside `confirmRewrite`, because it is the
    shared vocabulary of every rewrite flow rather than any one flow's own type.
    All three flow modules and `context-menu.tsx` import it from there.

  One context type for all three keeps the menu's three call sites identical and
  keeps every store read at the call site rather than inside the flows, which is
  what makes the flows unit-testable.

- [ ] **Step 1: Write the failing reword tests**

The behaviours worth pinning are the branch between the two paths and the no-op
guard — not the dialog plumbing.

```ts
// src/features/commits/rewordCommit.test.ts
describe("rewordCommit", () => {
  it("amends in place when the target is HEAD, with no rebase", async () => {
    // prompt resolves "new message"
    await rewordCommit({ oid: "head123" }, ctx({ headOid: "head123" }));
    expect(amendMessageSpy).toHaveBeenCalledWith("head123", "new message");
    expect(rebaseStartSpy).not.toHaveBeenCalled();
  });

  it("runs a one-step Reword plan for an older commit", async () => {
    await rewordCommit({ oid: "c2" }, ctx({ headOid: "c3" }));
    expect(amendMessageSpy).not.toHaveBeenCalled();
    expect(rebaseStartSpy).toHaveBeenCalledWith([
      { oid: "c2", action: "Reword", message: "new message" },
      { oid: "c3", action: "Pick", message: null },
    ]);
  });

  it("does nothing when the message comes back unchanged", async () => {
    // prompt resolves exactly fullCommitMessage(target)
    await rewordCommit({ oid: "head123" }, ctx({ headOid: "head123" }));
    expect(amendMessageSpy).not.toHaveBeenCalled();
    expect(rebaseStartSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the prompt is dismissed", async () => {
    // prompt resolves null
    await rewordCommit({ oid: "head123" }, ctx({ headOid: "head123" }));
    expect(amendMessageSpy).not.toHaveBeenCalled();
  });

  it("prefills the prompt with the commit's full existing message", async () => {
    await rewordCommit({ oid: "c2" }, ctx({ headOid: "c3" }));
    expect(promptSpy.mock.calls[0][0].initialValue).toBe("c2 subject\n\nc2 body");
  });
});
```

Mock `pgPrompt` / `pgConfirm` from `@/design` and the store, following the
mocking conventions in `src/test/setup.ts` and the existing
`context-menu.squash.test.tsx`. **Use `fireEvent`, never
`userEvent.setup()`, anywhere a clipboard is involved** — `userEvent.setup()`
replaces `navigator.clipboard` and silently detaches spies on it.

- [ ] **Step 2: Run and confirm failure**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/rewordCommit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `rewordCommit.ts`**

```ts
import { pgFlash, pgPrompt } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { CommitInfo } from "@/lib/types";
import { buildRebasePlan } from "./buildRebasePlan";
import { fullCommitMessage } from "./commitMessageText";
import { runRebasePlanNow } from "./runRebasePlan";
import { confirmRewrite, type RewriteCtx } from "./rewriteWarning";

/**
 * Edit one commit's message.
 *
 * TWO paths, and the split is not an optimisation. The rebase engine refuses a
 * dirty worktree, and rewording the commit you are sitting on is the common
 * case — so HEAD gets a message-only amend that ignores the index, and only an
 * older commit pays for a replay.
 */
export async function rewordCommit(
  target: { oid: string },
  ctx: RewriteCtx,
): Promise<void> {
  const self = ctx.commits.find((c) => c.oid === target.oid);
  if (!self) return;

  const existing = fullCommitMessage(self);
  const next = await pgPrompt({
    title: "Edit commit message",
    body: `Rewriting ${target.oid.slice(0, 7)}.`,
    initialValue: existing,
    confirmLabel: "Save",
    requireValue: true,
    multiline: 8,
  });
  if (next === null) return;

  // An unchanged message must not rewrite the SHA. Every downstream ref would
  // move for nothing, and on a published commit it would demand a force-push
  // for nothing.
  if (next === existing) return;

  const isHead = ctx.headOid === target.oid;
  const baseOid = self.parents[0] ?? null;

  if (
    !(await confirmRewrite({
      title: `Reword ${target.oid.slice(0, 7)}?`,
      body: isHead
        ? "The commit keeps its changes, author and date; only the message and the commit id change."
        : "Every commit after this one is replayed, so they all get new ids.",
      confirmLabel: "Reword",
      repoId: ctx.repoId,
      oid: target.oid,
      upstream: ctx.upstream,
    }))
  )
    return;

  if (isHead) {
    if (await useRepoStore.getState().amendMessage(target.oid, next)) {
      pgFlash("message updated");
    }
    return;
  }

  if (!baseOid) return;
  const plan = buildRebasePlan(ctx.commits, baseOid, {
    kind: "reword",
    targetOid: target.oid,
    message: next,
  });
  if (!plan) return;
  const outcome = await runRebasePlanNow(plan);
  if (outcome === "done") pgFlash("message updated");
  else if (outcome === "paused") pgFlash("reword paused — see the Conflicts screen");
}
```

- [ ] **Step 4: Run, confirm green**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/rewordCommit.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing drop tests, then implement `dropCommit.ts`**

```ts
describe("dropCommit", () => {
  it("runs a plan that drops the target and picks everything newer", async () => {
    await dropCommit({ oid: "c2" }, ctx({ headOid: "c3" }));
    expect(rebaseStartSpy).toHaveBeenCalledWith([
      { oid: "c2", action: "Drop", message: null },
      { oid: "c3", action: "Pick", message: null },
    ]);
  });

  it("does nothing when the confirm is declined", async () => {
    // confirm resolves false
    await dropCommit({ oid: "c2" }, ctx({ headOid: "c3" }));
    expect(rebaseStartSpy).not.toHaveBeenCalled();
  });

  it("does nothing for a root commit — there is no base to replay onto", async () => {
    await dropCommit({ oid: "c1" }, ctx({ headOid: "c3" })); // c1 has no parents
    expect(rebaseStartSpy).not.toHaveBeenCalled();
  });
});
```

```ts
// src/features/commits/dropCommit.ts — same imports as rewordCommit
/**
 * Remove one commit from history, replaying everything after it.
 *
 * Danger-confirmed: unlike a revert, nothing records that this commit existed.
 */
export async function dropCommit(
  target: { oid: string },
  ctx: RewriteCtx,
): Promise<void> {
  const self = ctx.commits.find((c) => c.oid === target.oid);
  const baseOid = self?.parents[0] ?? null;
  if (!self || !baseOid) return;

  if (
    !(await confirmRewrite({
      title: `Drop ${target.oid.slice(0, 7)}?`,
      body: `"${self.summary}" is removed from history and every commit after it is replayed with a new id. Nothing records that it existed — use Revert instead to undo its changes with a new commit.`,
      confirmLabel: "Drop",
      danger: true,
      repoId: ctx.repoId,
      oid: target.oid,
      upstream: ctx.upstream,
    }))
  )
    return;

  const plan = buildRebasePlan(ctx.commits, baseOid, {
    kind: "drop",
    targetOid: target.oid,
  });
  if (!plan) return;
  const outcome = await runRebasePlanNow(plan);
  if (outcome === "done") pgFlash("commit dropped");
  else if (outcome === "paused") pgFlash("drop paused — see the Conflicts screen");
}
```

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/dropCommit.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing undo tests, then implement `undoCommit.ts`**

```ts
describe("undoCommit", () => {
  it("soft-resets to the parent, leaving the work staged", async () => {
    await undoCommit({ oid: "head123" }, ctx({ headOid: "head123" }));
    expect(resetSpy).toHaveBeenCalledWith("parent1", "Soft");
  });

  it("does nothing for a commit that is not HEAD", async () => {
    await undoCommit({ oid: "c2" }, ctx({ headOid: "c3" }));
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it("does nothing for a root commit — there is no parent to reset to", async () => {
    await undoCommit({ oid: "c1" }, ctx({ headOid: "c1" })); // c1 has no parents
    expect(resetSpy).not.toHaveBeenCalled();
  });
});
```

```ts
// src/features/commits/undoCommit.ts
/**
 * Undo the last commit, keeping its changes staged — `reset --soft HEAD^`.
 *
 * HEAD only, which is the only commit this means anything for: undoing an older
 * commit is a drop or a revert, and both have their own entry. It exists as its
 * own entry because the alternative is right-clicking a DIFFERENT commit (the
 * parent) and reaching into the reset submenu — this names the intent instead of
 * the mechanism.
 */
export async function undoCommit(
  target: { oid: string },
  ctx: RewriteCtx,
): Promise<void> {
  if (ctx.headOid !== target.oid) return;
  const self = ctx.commits.find((c) => c.oid === target.oid);
  const parent = self?.parents[0] ?? null;
  if (!self || !parent) return;

  if (
    !(await confirmRewrite({
      title: `Undo ${target.oid.slice(0, 7)}?`,
      body: `"${self.summary}" stops being a commit. Its changes stay in your working tree, staged and ready to commit again.`,
      confirmLabel: "Undo commit",
      repoId: ctx.repoId,
      oid: target.oid,
      upstream: ctx.upstream,
    }))
  )
    return;

  await useRepoStore.getState().reset(parent, "Soft");
  pgFlash("commit undone — changes are staged");
}
```

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/undoCommit.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```
feat(commits): add the reword, drop and undo-commit flows
```

---

### Task 7: the three menu entries, and the squash/fixup retrofit

**Files:**
- Modify: `src/design/context-menu.tsx` (`commitMenuItems`, ~line 476-720)
- Create: `src/design/context-menu.rewrite.test.tsx`

**Interfaces:**
- Consumes: `rewordCommit` / `dropCommit` / `undoCommit` / `RewriteCtx` (Task 6),
  `confirmRewrite` (Task 5).

- [ ] **Step 1: Write the failing menu tests**

Follow `src/design/context-menu.squash.test.tsx` exactly — it already builds the
store fixture `commitMenuItems` reads (`commits`, `branches`, `headInfo`) and has
a `labeled(items, /re/)` helper. Reuse both.

```ts
describe("Edit commit message", () => {
  it("is offered for a commit on this branch", () => {
    const item = labeled(commitMenuItems({ sha: B }), /Edit commit message/);
    expect(item.disabled).toBeFalsy();
  });

  it("is offered for HEAD even when HEAD is a merge — an amend keeps its parents", () => {
    // headInfo.headOid = MERGE, and MERGE has two parents
    const item = labeled(commitMenuItems({ sha: MERGE }), /Edit commit message/);
    expect(item.disabled).toBeFalsy();
  });

  it("is refused for an OLDER merge commit, and says why", () => {
    const item = labeled(commitMenuItems({ sha: OLD_MERGE }), /Edit commit message/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/merge commit/);
  });

  it("is refused for a commit that is not on this branch, and says why", () => {
    const item = labeled(commitMenuItems({ sha: OFF_BRANCH }), /Edit commit message/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/not on this branch/);
  });
});

describe("Drop this commit", () => {
  it("is refused for a merge commit, and says why", () => {
    const item = labeled(commitMenuItems({ sha: MERGE }), /Drop/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/merge commit/);
  });

  it("is refused for the root commit", () => {
    const item = labeled(commitMenuItems({ sha: ROOT }), /Drop/);
    expect(item.disabled).toBe(true);
  });
});

describe("Undo this commit", () => {
  it("is offered for HEAD", () => {
    const item = labeled(commitMenuItems({ sha: HEAD_SHA }), /Undo this commit/);
    expect(item.disabled).toBeFalsy();
  });

  it("is refused for any other commit, and says why", () => {
    const item = labeled(commitMenuItems({ sha: B }), /Undo this commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/only the last commit/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `~/Library/pnpm/pnpm vitest run src/design/context-menu.rewrite.test.tsx`
Expected: FAIL — no such menu entries.

- [ ] **Step 3: Add a `RewriteCtx` builder next to `ancestryLog`**

In `context-menu.tsx`, beside the existing private helpers (~line 728). Reads the
store synchronously, which is all menu building may do:

```ts
/** The store reads the rewrite flows need, gathered at menu-build time. */
function rewriteCtx(commits: CommitInfo[]): RewriteCtx {
  const s = useRepoStore.getState();
  return {
    commits,
    repoId: s.current?.id ?? "",
    upstream: currentBranch(s.branches)?.upstream ?? null,
    headOid: s.headInfo?.headOid ?? null,
  };
}
```

Import `currentBranch` from `@/lib/derive` if it is not already imported there.

- [ ] **Step 4: Add the three entries**

Inside `commitMenuItems`, in the rewrite group — after the `Reset current branch
to here` submenu and before `Fixup this commit into its parent`, so the order
matches the spec's menu layout. `isHead` is computed once beside the existing
`onBranch` / `isMerge` / `baseOid`:

```ts
  const headOid = useRepoStore.getState().headInfo?.headOid ?? null;
  const isHead = !!commit?.sha && commit.sha === headOid;
```

then:

```ts
    {
      icon: "edit",
      label: !onBranch
        ? "Edit commit message — not on this branch"
        : isMerge && !isHead
          ? "Edit commit message — merge commit"
          : "Edit commit message…",
      // A merge is only refused on the REBASE path: buildRebasePlan emits Drop
      // for a merge, so rewording an older one would flatten history. Amending
      // HEAD's own message keeps its parents, so a merge at HEAD is fine.
      disabled: !onBranch || (isMerge && !isHead) || (!isHead && !baseOid),
      onClick: () => {
        if (!commit?.sha) return;
        void rewordCommit({ oid: commit.sha }, rewriteCtx(commits));
      },
    },
    {
      icon: "undo",
      label: !isHead
        ? "Undo this commit — only the last commit can be undone"
        : !baseOid
          ? "Undo this commit — root commit"
          : "Undo this commit…",
      disabled: !isHead || !baseOid,
      onClick: () => {
        if (!commit?.sha) return;
        void undoCommit({ oid: commit.sha }, rewriteCtx(commits));
      },
    },
```

and after the `Squash this commit into its parent` entry:

```ts
    {
      icon: "trash",
      label: !onBranch
        ? "Drop this commit — not on this branch"
        : isMerge
          ? "Drop this commit — merge commit"
          : !baseOid
            ? "Drop this commit — root commit"
            : "Drop this commit",
      danger: true,
      disabled: !onBranch || isMerge || !baseOid,
      onClick: () => {
        if (!commit?.sha) return;
        void dropCommit({ oid: commit.sha }, rewriteCtx(commits));
      },
    },
```

Check `"edit"`, `"undo"` and `"trash"` are declared in `IconName`
(`src/design/icons.tsx`) — `test/iconSet.test.ts` fails the build for a literal
the union does not declare. All three are already used elsewhere in this file, so
they should be fine; verify rather than assume.

- [ ] **Step 5: Retrofit the warning onto Squash and Fixup**

Both already `await` inside `onClick`, so this is replacing their bare run with
the shared confirm. In the **Fixup** entry, before `buildRebasePlan`:

```ts
        if (
          !(await confirmRewrite({
            title: `Fixup ${sha.slice(0, 7)} into its parent?`,
            body: "The two commits become one, keeping the parent's message.",
            confirmLabel: "Fixup",
            repoId: useRepoStore.getState().current?.id ?? "",
            oid: commit.sha,
            upstream: currentBranch(useRepoStore.getState().branches)?.upstream ?? null,
          }))
        )
          return;
```

In the **Squash** entry, the prompt already asks a question, so the warning must
not become a second modal in front of it — a modal over a modal cannot be
dismissed predictably (see the queue note in `dialog.tsx`). Instead, put the
warning in the PROMPT's own `body`:

```ts
        const ctx = rewriteCtx(commits);
        const warning = rewriteWarning(
          ctx.upstream,
          await isPublished(ctx.repoId, target, ctx.upstream),
        );
        const msg = await pgPrompt({
          title: "Squash into parent",
          body: warning
            ? `Message for the combined commit — the parent's, then this one's.\n\n${warning}`
            : "Message for the combined commit — the parent's, then this one's.",
          // ...the rest unchanged
        });
```

Add a test for each:

```ts
it("warns in the fixup confirm when the commit is published", async () => {
  // ahead_behind -> { behind: 0 }
  await labeled(commitMenuItems({ sha: B }), /Fixup/).onClick?.();
  expect(confirmSpy.mock.calls[0][0].body).toMatch(/already on origin\/main/);
});

it("warns inside the squash PROMPT, not a second dialog in front of it", async () => {
  await labeled(commitMenuItems({ sha: B }), /Squash/).onClick?.();
  expect(promptSpy.mock.calls[0][0].body).toMatch(/already on origin\/main/);
  expect(confirmSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run the menu suites and the type-check**

Run: `~/Library/pnpm/pnpm vitest run src/design/`
Expected: PASS — the new file plus every pre-existing `context-menu.*` suite. The
squash and commitdiff suites assert menu label sets, so a new entry may require
updating an expected list; update those assertions to include the new labels.
Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```
feat(commits): reword, drop and undo a commit from the History menu
```

---

### Task 8: docs, then the full gates

**Files:**
- Modify: `docs/dev/frontend.md` (the commit-menu / rewrite-flow area)
- Modify: `docs/dev/backend.md` (beside the commit + signing notes)
- Modify: `CLAUDE.md` — **only** if a load-bearing rule changed. One did: the
  published-commit warning is now shared by all five rewrite entries, which is
  exactly the kind of "one surface" rule that file records. Add at most two
  lines with a pointer; keep it short, as its own header demands.

- [ ] **Step 1: Write the docs**

`docs/dev/frontend.md`: the `features/commits/` rewrite modules, the two reword
paths and why HEAD has its own, the no-op-on-unchanged-message guard, and the
reason the squash warning lives in the prompt body rather than a second dialog.

`docs/dev/backend.md`: `amend_head_message` — message-only via `tree: None`,
verify-and-mutate under one lock, which hooks run and the deliberate `pre-commit`
omission, and **the known gap**: the rebase engine's `Reword` arm
(`libgit2.rs:971`) uses bare `head.amend` and drops a signature, which this op
does not. Recording it is the point; it is not fixed here.

- [ ] **Step 2: Run every gate**

Run each and read the output — a watcher's exit code is not evidence.

```
~/Library/pnpm/pnpm tsc --noEmit
~/Library/pnpm/pnpm test
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all green, including the `docs` vitest project (`test/docs.test.ts`),
`test/appErrors.test.ts` (no new variant, so it should be untouched),
`test/iconSet.test.ts` and `test/privacy.test.ts`.

Note: `ImageDiffView`'s delta test flakes about 1 run in 111. A red `unit` on a
diff that never touched `features/diff` is that flake — re-run rather than audit.

- [ ] **Step 3: Commit**

```
docs(commits): document the rewrite entries and the reword paths
```

---

### Task 9: e2e

Run e2e only now, at the end, and only the relevant spec.

- [ ] **Step 1: Read the skill first**

`.claude/skills/e2e-testing/SKILL.md` — required before writing or debugging any
spec. Note in particular that `isDisplayed` caches an element id and never
re-resolves, so a re-render kills the wait; `waitForExist` is immune.

- [ ] **Step 2: Add coverage to the existing history-ops spec**

Reword HEAD with a dirty worktree (the case the rebase engine cannot serve — this
is the assertion that would have caught a one-step-rebase implementation), then
reword an older commit, asserting the subject in the log afterwards.

- [ ] **Step 3: Rebuild the snapshot, then run only that spec**

A `src/` or `src-tauri/` change means the snapshot is stale. One cold container
build at a time across ALL worktrees.

```
~/Library/pnpm/pnpm test:e2e:docker build
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/history-ops.e2e.ts
```

Never run e2e natively, and never run a full vitest suite alongside a Docker e2e
build — the contention fakes a red.

- [ ] **Step 4: Commit, push, open the PR**

`gh pr create` with `--body-file` (a `--body` with prose is refused in this
worktree). The PR body should link the spec and this plan, and state plainly that
the rebase reword path drops signatures and that this is pre-existing.

---

## The remaining PRs

Each gets its own plan, written when it starts, against the same spec:

| PR | Entries | New backend op |
| --- | --- | --- |
| 2 | Show Repository at Revision, Go to Parent / Child Commit | — |
| 3 | View in browser | commit web URL |
| 4 | Create Patch… | format-patch |
| 5 | Push All up to Here… | push refspec |
