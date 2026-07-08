# History inline commit diff — implementation plan

Spec: `docs/superpowers/specs/2026-07-08-history-inline-commit-diff-design.md`
Issue: #53

## Backend (Rust)

1. **`src-tauri/src/git/mod.rs`** — add to `GitBackend`:
   ```rust
   fn diff_commit(&self, repo_id: &RepoId, oid: &str, context_lines: u32)
       -> AppResult<Vec<FileDiff>>;
   ```
2. **`src-tauri/src/git/libgit2.rs`**
   - Extract the delta→`FileDiff` loop from `diff_commits` into a free fn
     `diff_to_file_diffs(diff: &mut git2::Diff) -> AppResult<Vec<FileDiff>>`
     (renames already resolved by the caller via `find_similar`).
   - `diff_commits` calls the helper.
   - `diff_commit`: `revparse_single(oid).peel_to_commit()`; `to_tree =
     commit.tree()`; `from_tree = commit.parent(0).ok().map(|p| p.tree())`
     (None for root); `diff_tree_to_tree(from_tree.as_ref(), Some(&to_tree),
     opts)`; `find_similar`; helper.
3. **`src-tauri/src/git/cli.rs`** — `diff_commit` → `Err(AppError::NotImplemented)`.
4. **`src-tauri/src/commands/diff.rs`** — `#[tauri::command] pub async fn
   diff_commit(...)` wrapping `backend.diff_commit` in `spawn_blocking`.
5. **`src-tauri/src/lib.rs`** — register `diff_commit` in `invoke_handler!`.
6. **Rust test** (`src-tauri/tests/...` diff test file) — `diff_commit` on a
   normal commit (parent..commit; only that commit's file), a root commit
   (all-added), and a merge commit (vs first parent).

## Frontend (TS)

7. **`src/lib/tauri.ts`** — `diffCommit(repoId, oid, contextLines = 3)` wrapper
   → `invoke("diff_commit", { repoId, oid, contextLines })`.
8. **`src/features/nav/useNavStore.ts`** — add `{ kind: "commit-self"; oid: string }`.
9. **`src/features/diff/CommitDiffPanel.tsx`** — new. Props:
   `{ diffs, loading, error, header, paneIdPrefix, emptyLabel? }`.
   Internal `selected` path (reset to `diffs[0]` when `diffs` changes),
   `usePaneList` on `${prefix}.files`, `useHunkNav` on
   `[${prefix}.files, ${prefix}.view]`. Renders the two `PGPane`s exactly as
   `CommitDiffScreen` does today.
10. **`src/screens/CommitDiff.tsx`** — replace the inline JSX with
    `<CommitDiffPanel paneIdPrefix="commitDiff" ... />`; add `commit-self`
    target fetched via `diffCommit`; header per target kind.
11. **`src/screens/History.tsx`**
    - `onActivate` → `setNavIntent({ kind: "commit-self", oid })`.
    - Fetch `diffCommit(repo.id, current.oid, ctx)` on selection change,
      cancellable; hold `{ diffs, loading, error }`.
    - Layout state `below | beside` from `localStorage["pg-history-diff-layout"]`
      (default `below`), toggle control in the toolbar-right.
    - **below**: column — commit list on top, resize handle (vertical),
      diff region below = compact metadata + action row + `CommitDiffPanel`.
      Height via `usePaneWidth(320, { storageKey: "pg-history-diff-h" })`.
    - **beside**: today's row layout; right pane = metadata + action row +
      `CommitDiffPanel` (replaces the parents-only section). Width reuses
      `pg-history-detail-w`.
    - Panel `paneIdPrefix="history.diff"`.
12. **`src/AppShell.tsx`** — route `commit-self` → `setScreen("commitDiff")`.
13. **`src/design/resizable.tsx`** — `PGResizeHandle` gains `orientation`
    (`"horizontal" | "vertical"`, default horizontal): vertical uses `clientY`,
    `row-resize`, and a `height: 4` handle. Backward compatible.

## Tests

14. **`src/screens/History.keyboard.test.tsx`** — Enter now asserts
    `{ kind: "commit-self", oid }`.
15. **`src/screens/History.diff.test.tsx`** (new) — mock `diff_commit` invoke;
    assert selecting a commit renders its changed files inline.
16. **`e2e/specs/history-diff.e2e.ts`** — extend: open History, select a
    commit, assert the inline changed-file list + a hunk appear (no screen
    switch). Run only this spec at the end.

## Verify

- `pnpm tsc --noEmit`, `pnpm exec tsc -p e2e/tsconfig.json --noEmit`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm test`
- `pnpm test:e2e:build` then `pnpm test:e2e:run --spec e2e/specs/history-diff.e2e.ts`
- Then squash → PR.
