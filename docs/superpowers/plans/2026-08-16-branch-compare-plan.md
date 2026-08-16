# Branch compare — implementation plan

**Goal:** Answer "what is on `feature/x` that is not on `main`", and "what is on
disk that is not on `main`". A new deep-view `compare` screen owns two mutable
sides, an exact ahead/behind summary, both commit lists, and the combined file
diff — the last through the existing `CommitDiffPanel`, so the whole `DiffRow`
pipeline comes along unchanged.

**Architecture:** Three additive `GitBackend` ops (`diff_ref_to_workdir`,
`ahead_behind`, `commits_between`), each on the standard six-step path. One new
frontend feature folder (`features/compare/`) with a pure side model, a ref
picker, and a store; one new screen; one new `NavIntent` kind; menu + palette
entries. `useRepoStore` and `RepoSlice` are untouched — compare state is a
feature store, not per-repo state.

**Tech Stack:** Rust + libgit2 (`git2`), Tauri 2 commands, React 18 + Zustand,
vitest/RTL.

**Design doc:** `docs/superpowers/specs/2026-08-16-branch-compare-spec.md`
**Issue:** [#131](https://github.com/jonassaa/platypusgit/issues/131)

## Global Constraints

- Every IPC-crossing fn returns `AppResult<T>`; no new `AppError` variants
  needed (`InvalidRef` covers the new failures). TS `AppError` stays 1:1.
- Wrap every `git2` call in `spawn_blocking` from the command layer.
- Frontend never calls `invoke()` directly — typed wrappers in `src/lib/tauri.ts`.
- UI primitives from `@/design` only; never `src/components/ui/`.
- Any new list-row surface opts into density: `height: "calc(<base>px + var(--row-step))"`.
- Never `window.confirm`/`window.prompt`.
- Never hardcode the accent hue — `var(--accent)` / `oklch(from var(--accent) …)`.
- The compare screen must not add a per-repo field to `useRepoStore`; if it ever
  does, `RepoSlice`/`emptySlice` must gain it the same commit.
- Run pnpm/cargo with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **Do not run e2e in this change.**

## File Structure

**Create:**
- `src-tauri/tests/ref_compare.rs` — backend integration tests for all three ops.
- `src/features/compare/compareSides.ts` — pure side model + labels + swap rule.
- `src/features/compare/compareSides.test.ts`
- `src/features/compare/useCompareStore.ts` — sides, results, loading, the
  compare mark.
- `src/features/compare/CompareSidePicker.tsx` — the side chip's popover.
- `src/screens/Compare.tsx`
- `src/screens/Compare.test.tsx`

**Modify:**
- `src-tauri/src/git/types.rs` — `AheadBehind`.
- `src-tauri/src/git/mod.rs` — three trait methods + docs.
- `src-tauri/src/git/libgit2.rs` — the three implementations.
- `src-tauri/src/git/cli.rs` — three `NotImplemented` stubs.
- `src-tauri/src/commands/diff.rs` — `diff_ref_to_workdir`.
- `src-tauri/src/commands/commits.rs` — `ahead_behind`, `commits_between`.
- `src-tauri/src/lib.rs` — register the three commands.
- `src/lib/types.ts` — `AheadBehind`.
- `src/lib/tauri.ts` — `diffRefToWorkdir`, `aheadBehind`, `commitsBetween`.
- `src/features/nav/useNavStore.ts` — `ref-compare` intent.
- `src/AppShell.tsx` — `compare` screen id, `DEEP_VIEWS`, screens map, routing.
- `src/features/nav/DeepViewHeader.tsx` — label for the new origin id set.
- `src/design/context-menu.tsx` — `compareMenuItems`, spliced into
  `branchMenuItems` + `remoteBranchMenuItems`.
- `src/features/palette/commands.ts` — two compare commands.
- `src/AppShell.screens.test.tsx` — include `compare` in the sweep.

---

### Task 1: Backend — `diff_ref_to_workdir`

- [ ] `ref_compare.rs` first: a repo with a committed baseline, then a staged
      edit, an unstaged edit, an untracked file and a `.gitignore`d file.
      `include_untracked: true` must show the first three and never the fourth;
      `false` must drop the untracked one only. A second case resolves a **tag**
      and a **branch name**; a third asserts `InvalidRef` on `"no-such-ref"`.
- [ ] Trait method on `GitBackend` with the doc from spec §C/§D1 (why
      `_with_index`, what `include_untracked` means, who else will call it).
- [ ] `Libgit2Backend`: `revparse_single(revspec).and_then(peel_to_tree)` mapped
      to `InvalidRef`, `DiffOptions` (context, ignore_whitespace, and the
      untracked triple only when the flag is set), `diff_tree_to_workdir_with_index`,
      `find_similar` renames, `diff_to_file_diffs`.
- [ ] `CliBackend` stub.
- [ ] `commands/diff.rs::diff_ref_to_workdir` — `ignore_whitespace` and
      `include_untracked` both `Option<bool>` so an older caller keeps git
      defaults, matching `get_diff`/`diff_commits`.
- [ ] Register in `lib.rs`.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`.

### Task 2: Backend — `ahead_behind` + `commits_between`

- [ ] `ref_compare.rs`: build `main` and `feature` diverged by 2 and 3 commits.
      `ahead_behind("main", "feature")` → `ahead: 3, behind: 2` with a
      `merge_base` equal to the fork point; the reversed call mirrors it. An
      ancestor pair gives one zero. Two unrelated root histories give
      `merge_base: None` and both counts non-zero. `InvalidRef` on garbage.
- [ ] `commits_between("main", "feature", 10)` → the 3 feature-only commits
      newest-first; the reverse → the 2 main-only ones; `limit: 1` truncates.
      Assert explicitly that it does **not** require ancestry (the case
      `commits_since` rejects).
- [ ] `types.rs`: `AheadBehind { ahead, behind, merge_base }`, `serde` rename to
      camelCase like its neighbours.
- [ ] Trait + `Libgit2Backend` (`graph_ahead_behind`, `merge_base` → `Option`) +
      `CliBackend` stubs.
- [ ] `commands/commits.rs`: both commands, `limit: Option<usize>` defaulted like
      `get_log`.
- [ ] Register in `lib.rs`; `cargo test`.

### Task 3: TS types + wrappers + nav intent

- [ ] `lib/types.ts`: `AheadBehind`.
- [ ] `lib/tauri.ts`: `diffRefToWorkdir`, `aheadBehind`, `commitsBetween`, each
      documented with the direction convention.
- [ ] `useNavStore`: `{ kind: "ref-compare"; left: CompareSide; right: CompareSide }`.
      The type lives in `features/compare/compareSides.ts`; the nav store imports
      it (nav already imports `RebaseStep` from `lib/types`, so a feature-owned
      type is the only new shape here — keep it a pure module with no store
      import, so nav does not gain a feature dependency cycle).
- [ ] `pnpm tsc --noEmit`.

### Task 4: `compareSides.ts` (pure) + tests

- [ ] `CompareSide`, `sideLabel`, `sideKey` (a stable string for effect deps),
      `compareHeader(left, right)` (`"main → feature/x"`, `"main → working tree"`),
      `canSwap` / `swapSides` — swapping when the right side is `workdir` is a
      no-op, because the working tree cannot be a left side (spec §B).
- [ ] `DEFAULT_LEFT` derivation from the branch list (`currentBranch(...) ?? "HEAD"`)
      as a pure function taking the branches array, so the screen has no fallback
      logic of its own.
- [ ] `compareSides.test.ts` covering each of the above.

### Task 5: `useCompareStore`

- [ ] State: `repoId`, `left`, `right`, `diffs`, `aheadBehind`, `aheadCommits`,
      `behindCommits`, `loading`, `error`, `marked`.
- [ ] `open(left, right)` sets both sides, stamps `repoId` from
      `useRepoStore.getState().current`, clears results.
- [ ] `refresh(contextLines, ignoreWhitespace)`: captures `repoId` first and
      drops every write whose captured id no longer matches the live one — the
      same staleness guard `setFor` gives `useRepoStore`, on repo identity, because
      a tab switch can land between the request and its resolution.
- [ ] rev↔rev issues `aheadBehind` + two `commitsBetween` + `diffCommits`;
      rev↔workdir issues `diffRefToWorkdir(…, includeUntracked: true)` only and
      clears the commit state.
- [ ] `setLeft` / `setRight` / `swap` / `mark(ref)` / `clearMark()`.
- [ ] Errors are stored locally (`error`), never pushed into `useRepoStore` — a
      bad revspec typed into a picker is not a repo-level failure and must not
      raise the app banner.

### Task 6: `CompareSidePicker` + the compare bar

- [ ] Popover anchored to the chip, portal'd, closing on outside mousedown and
      Escape — the `RebaseBasePicker` shape, deliberately NOT a generalisation of
      it: that one yields an **oid** and a rebase-specific label, this one yields
      a **revspec** (so the header keeps reading `main`, not `a1b2c3`) and offers
      `Working tree`, which has no oid at all.
- [ ] Sections: local branches, remote branches, tags, `Working tree` (right side
      only), and a free-form row that accepts whatever was typed as a revspec.
- [ ] Rows are density-aware; the picker itself is chrome.
- [ ] `data-testid`: `compare-side-left`, `compare-side-right`,
      `compare-side-option`.

### Task 7: `screens/Compare.tsx`

- [ ] `DeepViewHeader crumbs={[compareHeader(left, right)]}`.
- [ ] Bar (`data-testid="compare-bar"`): left chip · `→` · right chip · swap ·
      summary (`compare-summary`: `↑ahead ↓behind`, merge base short sha, or
      "unrelated histories") · refresh button. `WhitespaceToggle` stays inside
      `CommitDiffPanel`, where it already lives.
- [ ] rev↔rev body: a vertical split — top section holds two `PGPane`s side by
      side (`compare.ahead` / `compare.behind`) each with a heading and its
      commit rows, `usePaneWidth` reused as a HEIGHT with
      `PGResizeHandle orientation="vertical"`, exactly as `History` does for its
      detail panel; bottom is `<CommitDiffPanel paneIdPrefix="compare" …>`.
- [ ] rev↔workdir body: `CommitDiffPanel` only, plus the dimmed
      "untracked files included" note on the right chip.
- [ ] `syntaxSides`: `old = { kind: "rev", rev: left.rev }`,
      `new = right.kind === "workdir" ? { kind: "worktree" } : { kind: "rev", rev: right.rev }`
      — `SideSource` already has a `worktree` kind, so whole-file mode works on
      both shapes with no new plumbing.
- [ ] Re-fetch effect keyed on `sideKey(left)`, `sideKey(right)`,
      `diffContextLines`, `ignoreWhitespace`, `repo.id` — primitives only, never
      the side objects, which are rebuilt each render.
- [ ] Commit rows are a local row component (sha · summary · author · relative
      time), density-aware; not `PGCommitRow`, which draws a graph lane these
      lists have no layout for.

### Task 8: Wiring — AppShell, menus, palette

- [ ] `AppShell`: `"compare"` in `ScreenId`, in `DEEP_VIEWS`, in the screens map;
      `case "ref-compare": enterDeep("compare")` in the intent switch.
- [ ] `DeepViewHeader.SCREEN_LABELS` — no change needed for `compare` itself (a
      deep view is never an origin), but confirm nothing regressed.
- [ ] `context-menu.tsx`: `compareMenuItems({ ref, isCurrent })` returning the
      three/four items from spec §E, spliced into `branchMenuItems` and
      `remoteBranchMenuItems` behind a divider. Each item calls
      `useCompareStore.getState().open(...)` then
      `useNavStore.getState().setIntent({ kind: "ref-compare", … })`.
- [ ] `commands.ts`: **Compare refs…** and **Compare with working tree…**, both
      `step(() => ({ kind: "pick", … branchItems({ … }) }))`.
- [ ] `AppShell.screens.test.tsx`: add `compare` where the sweep enumerates.

### Task 9: Frontend tests + full verification

- [ ] `Compare.test.tsx`: rev↔rev renders summary + both lists and calls
      `diff_commits`; rev↔workdir renders neither list and calls
      `diff_ref_to_workdir` with `includeUntracked: true`; swap flips the header;
      a rejected `diff_commits` renders the message in place.
- [ ] `pnpm tsc --noEmit`, `pnpm test`, `cargo check`, `cargo test`.
- [ ] Small Conventional Commits on `feat/branch-compare`; push; draft PR
      against #131. **No e2e run** — the orchestrator serialises it.
