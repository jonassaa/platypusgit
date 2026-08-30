# Plan — external diff tool (#235)

Spec: `docs/superpowers/specs/2026-08-30-external-difftool-spec.md`.
One PR, one squashed commit on `feat/external-difftool`.

## 1. Backend — the value

**`src-tauri/src/git/types.rs`**
- `DiffToolTarget` — `#[serde(tag = "kind", rename_all = "camelCase")]`,
  `Deserialize` only (it only travels frontend → backend). Variants:
  `Worktree`, `Staged`, `Commit { oid }`, `Range { from, to }`,
  `RevToWorktree { rev }`.

**`src-tauri/src/git/difftool.rs`** (new)
- `pub struct DiffSpec { cached: bool, revs: Vec<String> }` — what git needs,
  after the target has been resolved against the repository.
- `pub fn spec_for(repo: &git2::Repository, target: &DiffToolTarget) -> AppResult<DiffSpec>`
  — the only impure part: `Commit` looks up the first parent, falling back to
  `repo.treebuilder(None)?.write()?` for a root commit.
- `pub fn difftool_args(spec, tool: Option<&str>, paths: &[String]) -> Vec<String>`
  — PURE. `difftool --no-prompt --gui [--cached] [--tool=T] <revs…> -- <paths…>`.
- `pub fn normalize_tool(raw: Option<&str>) -> AppResult<Option<String>>` — PURE.
- `pub struct DiffToolPlan { workdir, args, tool }`.

**`src-tauri/src/git/mod.rs`** — `pub mod difftool;` + trait method:
```rust
fn difftool_plan(
    &self,
    repo_id: &RepoId,
    target: &DiffToolTarget,
    paths: &[String],
    tool: Option<&str>,
) -> AppResult<DiffToolPlan>;
```

**`src-tauri/src/git/libgit2.rs`** — implement: `with_repo` → workdir,
`safe_workdir_path` every path, `normalize_tool`, `spec_for`, `difftool_args`.

**`src-tauri/src/git/cli.rs`** — `NotImplemented` stub.

## 2. Backend — the spawn

**`src-tauri/src/commands/diff.rs`** — `open_in_difftool(repo_id, target, paths, tool)`:
`spawn_blocking` for the plan, then `proc::git_async_keeping_console(workdir)`
with `GIT_LITERAL_PATHSPECS=1` and `stderr(piped())`; non-zero exit →
`AppError::Git` carrying the stderr tail.

**`src-tauri/src/lib.rs`** — register `commands::diff::open_in_difftool`.

**`src-tauri/tests/spawn_no_window.rs`** — add
`src/commands/diff.rs` to `CONSOLE_KEEPING_CALLERS` with the reason.

**`src-tauri/src/git/stash.rs`** — its `LITERAL_PATHSPECS` doc says it is the
only pathspec-passing shell-out. It now has a second caller; fix the comment
rather than defining the constant twice.

## 3. Tests — Rust

**`src-tauri/tests/difftool.rs`** (new)
- argv table: every kind, with and without `--tool`, one path and two.
- `normalize_tool` accepts/trims/rejects.
- plan against a real repo: commit-vs-parent, root commit → empty tree,
  `../escape` → `InvalidPath`, unknown repo id.
- END-TO-END: temp repo, `diff.tool=pgfake`,
  `difftool.pgfake.cmd` writes `$LOCAL`/`$REMOTE` to a marker; run the plan's
  argv through `proc::git`; assert the marker holds two readable files with the
  expected contents. Second test sets `diff.tool` to a tool that would fail and
  passes `--tool=pgfake` to prove the override wins. Skip with an `eprintln!`
  when `git difftool` is unavailable.

## 4. Frontend

- `src/lib/types.ts` — `DiffToolTarget` mirror.
- `src/lib/tauri.ts` — `openInDifftool(repoId, target, paths, tool)`.
- `src/features/repo/repoActivity.ts` — `difftool` key + priority entry (not
  cancellable).
- `src/features/repo/useRepoStore.ts` — `openInDifftool(target, paths)`: reads
  `useSettingsStore.getState().externalDiffTool`, sets the activity entry,
  awaits, `refreshAll()`, `setErrorFor` on failure (refresh first, error last).
- `src/design/context-menu.tsx` — `externalDiffItem(target, paths)` helper +
  entry in `fileMenuItems` (after "Open in editor").
- `src/features/diff/CommitDiffPanel.tsx` — optional `difftoolTarget` prop, a
  `useContextMenu` over the file rows.
- `src/screens/CommitDiff.tsx`, `Compare.tsx`, `History.tsx` — pass the target.
- `src/features/settings/useSettingsStore.ts` — `externalDiffTool: ""`.
- `src/screens/Settings.tsx` — the field, in the Diff section.

## 5. Tests — frontend

- `src/design/contextMenu.difftool.test.ts` — the entry exists on both sides and
  dispatches the right target.
- `src/features/diff/CommitDiffPanel.difftool.test.tsx` — right-click a file row.
- `src/features/repo/useRepoStore.difftool.test.ts` — settings override reaches
  the invoke, activity entry set and cleared, refresh on success.
- `src/features/settings/useSettingsStore.export.test.ts` — add to `PORTABLE`.
- `src/screens/Settings.diff.test.tsx` — the field writes the setting.

## 6. Docs

- `docs/dev/architecture.md` — `git/difftool.rs` in the backend tree,
  `open_in_difftool` in the `commands/diff.rs` entry.
- `docs/dev/backend.md` — the two-shorthands-are-wrong note under a difftool
  heading; the `CONSOLE_KEEPING_CALLERS` bullet gains its second entry.
- `docs/dev/frontend.md` — one line in the diff-surfaces section.
- CLAUDE.md — untouched (it is a pointer file).

## Gates

`pnpm tsc --noEmit`, `pnpm test`, `cargo test`. No e2e spec, so no
`e2e/tsconfig.json` typecheck; CI runs the e2e suite unchanged.
